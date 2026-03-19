import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { getGateway } from "@/lib/payment/factory";
import { logAuditEvent } from "@/lib/audit";
import type { WebhookEvent } from "@/lib/payment/types";
import { BoletoStatus, PaymentStatus } from "@prisma/client";
import {
  RECEIVABLE_VALUE_TOLERANCE,
  RECEIVABLE_DUE_DATE_WINDOW_DAYS,
} from "@/lib/payment/constants";

// ---------------------------------------------------------------------------
// Status mapping: WebhookEvent.type → BoletoStatus
// ---------------------------------------------------------------------------

const WEBHOOK_TO_BOLETO_STATUS: Record<WebhookEvent["type"], BoletoStatus> = {
  "boleto.paid": BoletoStatus.PAID,
  "boleto.cancelled": BoletoStatus.CANCELLED,
  "boleto.expired": BoletoStatus.OVERDUE,
  "boleto.failed": BoletoStatus.CANCELLED,
};

// ---------------------------------------------------------------------------
// POST /api/webhooks/santander/[providerId]
//
// Santander-specific webhook receiver. Validates that providerId is a real,
// active Santander provider before processing. Uses the same boleto/receivable
// update logic as the generic webhook route.
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;

  console.log(`[santander-webhook] Received webhook for providerId: ${providerId}`);

  // 1. Read raw body — return 500 on failure to force Santander retry
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[santander-webhook] Failed to read request body:", err);
    return NextResponse.json({ error: "body_read_failed" }, { status: 500 });
  }

  // 2. Extract headers as plain object
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // 3. Validate providerId exists and is an active Santander provider
  const provider = await prisma.paymentProvider.findFirst({
    where: {
      id: providerId,
      provider: "santander",
      isActive: true,
    },
  });

  if (!provider) {
    console.warn(
      `[santander-webhook] No active Santander provider found for id: ${providerId}`,
    );
    // Return 200 to avoid infinite retries from Santander
    return NextResponse.json(
      { received: true, error: "provider_not_found" },
      { status: 200 },
    );
  }

  // 4. Instantiate gateway and validate webhook
  let gateway: ReturnType<typeof getGateway>;
  try {
    const decryptedCredentials = JSON.parse(
      decrypt(provider.credentials),
    ) as Record<string, unknown>;

    const metadata = provider.metadata as Record<string, unknown> | null;

    gateway = getGateway(
      "santander",
      decryptedCredentials,
      metadata,
      provider.webhookSecret ? decrypt(provider.webhookSecret) : undefined,
      { sandbox: provider.sandbox, companyId: provider.companyId },
    );
  } catch (err) {
    console.error(
      `[santander-webhook] Error instantiating provider ${providerId}:`,
      err,
    );
    return NextResponse.json(
      { received: true, error: "provider_init_failed" },
      { status: 200 },
    );
  }

  // 5. Validate the webhook request
  if (!gateway.validateWebhook(headers, rawBody)) {
    console.warn(
      `[santander-webhook] Validation failed for provider ${providerId}`,
    );
    return NextResponse.json(
      { error: "invalid_webhook" },
      { status: 400 },
    );
  }

  // 6. Parse the webhook event
  let event: WebhookEvent | null;
  try {
    event = gateway.parseWebhookEvent(rawBody);
  } catch (err) {
    console.error("[santander-webhook] Failed to parse webhook event:", err);
    return NextResponse.json(
      { received: true, error: "parse_error" },
      { status: 200 },
    );
  }

  // If provider returned null (unknown event type), acknowledge and skip
  if (!event) {
    return NextResponse.json(
      { received: true, skipped: "unknown_event_type" },
      { status: 200 },
    );
  }

  console.log(
    `[santander-webhook] Event parsed: type=${event.type}, gatewayId=${event.gatewayId}`,
  );

  // 7. Find boleto by gatewayId
  // The gatewayId from webhook may be partial (%.covenantCode.bankNumber)
  // or full (nsuCode.nsuDate.ENV.covenantCode.bankNumber)
  let boleto;
  if (event.gatewayId.startsWith("%.")) {
    // Partial gatewayId — search by suffix
    const suffix = event.gatewayId.slice(2); // Remove "%."
    boleto = await prisma.boleto.findFirst({
      where: {
        gatewayId: { endsWith: `.${suffix}` },
        providerId: provider.id,
      },
      include: {
        proposal: {
          select: {
            id: true,
            clientId: true,
            companyId: true,
          },
        },
      },
    });
  } else {
    boleto = await prisma.boleto.findFirst({
      where: {
        gatewayId: event.gatewayId,
        providerId: provider.id,
      },
      include: {
        proposal: {
          select: {
            id: true,
            clientId: true,
            companyId: true,
          },
        },
      },
    });
  }

  if (!boleto) {
    console.warn(
      `[santander-webhook] Boleto not found for gatewayId: ${event.gatewayId}, provider: ${provider.id}`,
    );
    // Log audit event for debugging — fire-and-forget
    logAuditEvent({
      userId: "system",
      action: "STATUS_CHANGE",
      entity: "Webhook",
      entityId: event.gatewayId,
      dataAfter: {
        source: "santander-webhook",
        providerId: provider.id,
        eventType: event.type,
        status: "boleto_not_found",
        rawGatewayId: event.gatewayId,
      },
      companyId: provider.companyId,
    }).catch((err) => console.error("Audit log failed:", err));

    return NextResponse.json(
      { received: true, boleto: "not_found" },
      { status: 200 },
    );
  }

  // 8. Map event type to boleto status
  const newBoletoStatus = WEBHOOK_TO_BOLETO_STATUS[event.type];
  if (!newBoletoStatus) {
    console.warn(
      `[santander-webhook] Unknown event type: ${event.type}, skipping`,
    );
    return NextResponse.json(
      { received: true, skipped: "unknown_event_type" },
      { status: 200 },
    );
  }

  // 9. Update boleto and receivable in a transaction
  let updatedReceivableId: string | null = null;
  let previousStatus: BoletoStatus = boleto.status as BoletoStatus;

  const txResult = await prisma.$transaction(async (tx) => {
    // SELECT FOR UPDATE to prevent race condition between concurrent webhooks
    const lockedBoleto = await tx.$queryRaw<
      Array<{ id: string; status: string; value: string }>
    >`
      SELECT id, status, value FROM boletos WHERE id = ${boleto.id} FOR UPDATE
    `;

    if (!lockedBoleto[0]) {
      return { skipped: true, reason: "not_found" } as const;
    }

    const currentStatus = lockedBoleto[0].status as BoletoStatus;

    // Idempotency — skip if already in target status
    if (currentStatus === newBoletoStatus) {
      return { skipped: true, reason: "already_in_status" } as const;
    }

    previousStatus = currentStatus;

    // Update boleto status
    await tx.boleto.update({
      where: { id: boleto.id },
      data: { status: newBoletoStatus },
    });

    // If paid: find and update matching AccountReceivable
    if (newBoletoStatus === BoletoStatus.PAID && boleto.proposal) {
      // Direct lookup via boletoId FK
      const receivable = await tx.accountReceivable.findFirst({
        where: {
          boletoId: boleto.id,
          companyId: boleto.companyId,
          status: PaymentStatus.PENDING,
        },
      });

      if (receivable) {
        await tx.accountReceivable.update({
          where: { id: receivable.id },
          data: {
            status: PaymentStatus.PAID,
            paidAt: event.paidAt ?? new Date(),
          },
        });
        updatedReceivableId = receivable.id;
      } else {
        // Fallback: heuristic match for legacy receivables without boletoId
        const boletoValue = Number(boleto.value);
        const tolerance = RECEIVABLE_VALUE_TOLERANCE;
        const dueDateWindow = RECEIVABLE_DUE_DATE_WINDOW_DAYS;
        const dueDateMin = new Date(boleto.dueDate);
        dueDateMin.setDate(dueDateMin.getDate() - dueDateWindow);
        const dueDateMax = new Date(boleto.dueDate);
        dueDateMax.setDate(dueDateMax.getDate() + dueDateWindow);

        const legacyReceivable = await tx.accountReceivable.findFirst({
          where: {
            companyId: boleto.companyId,
            clientId: boleto.proposal.clientId,
            boletoId: null,
            status: PaymentStatus.PENDING,
            value: {
              gte: boletoValue - tolerance,
              lte: boletoValue + tolerance,
            },
            dueDate: {
              gte: dueDateMin,
              lte: dueDateMax,
            },
          },
          orderBy: { dueDate: "asc" },
        });

        if (legacyReceivable) {
          await tx.accountReceivable.update({
            where: { id: legacyReceivable.id },
            data: {
              status: PaymentStatus.PAID,
              paidAt: event.paidAt ?? new Date(),
              boletoId: boleto.id,
            },
          });
          updatedReceivableId = legacyReceivable.id;
        }
      }
    }
    return { skipped: false } as const;
  });

  if (txResult.skipped) {
    console.log(
      `[santander-webhook] Boleto ${boleto.id} skipped: ${txResult.reason}`,
    );
    return NextResponse.json(
      { received: true, skipped: txResult.reason },
      { status: 200 },
    );
  }

  // 10. Log audit event — fire-and-forget
  logAuditEvent({
    userId: "system",
    action: "STATUS_CHANGE",
    entity: "Boleto",
    entityId: boleto.id,
    dataBefore: { status: previousStatus },
    dataAfter: {
      status: newBoletoStatus,
      webhookEvent: event.type,
      source: "santander-webhook",
      providerId: provider.id,
      gatewayId: event.gatewayId,
      paidAt: event.paidAt?.toISOString() ?? null,
      paidAmount: event.paidAmount ?? null,
      accountReceivableId: updatedReceivableId,
    },
    companyId: boleto.companyId,
  }).catch((err) => console.error("Audit log failed:", err));

  console.log(
    `[santander-webhook] Boleto ${boleto.id} updated: ${previousStatus} → ${newBoletoStatus}` +
      (updatedReceivableId ? ` | AR ${updatedReceivableId} → PAID` : ""),
  );

  // 11. Return 200 OK to Santander to confirm receipt
  return NextResponse.json({ received: true }, { status: 200 });
}
