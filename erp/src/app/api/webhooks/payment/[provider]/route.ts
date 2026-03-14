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
  CENTS_PER_UNIT,
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
// POST /api/webhooks/payment/[provider]
// Bug #14: [provider] param is now the provider ID (not type) for unique routing
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerParam } = await params;

  // Bug #11 fix: Return 500 on body read failure to force provider retry
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[webhook] Failed to read request body:", err);
    return NextResponse.json({ error: "body_read_failed" }, { status: 500 });
  }

  // 2. Extract headers as plain object
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // Bug #14: Try to find provider by ID first (new URL format), then fall back to type lookup
  let providers: Awaited<ReturnType<typeof prisma.paymentProvider.findMany>>;

  const providerById = await prisma.paymentProvider.findFirst({
    where: { id: providerParam, isActive: true },
  });

  if (providerById) {
    providers = [providerById];
  } else {
    // Legacy fallback: providerParam is a provider type
    providers = await prisma.paymentProvider.findMany({
      where: {
        provider: providerParam,
        isActive: true,
      },
    });
  }

  if (providers.length === 0) {
    console.warn(`[webhook] No active providers found for: ${providerParam}`);
    // Return 200 to avoid infinite retries from the bank
    return NextResponse.json({ received: true, error: "no_providers" }, { status: 200 });
  }

  // 4. Try to validate signature with each provider's webhookSecret
  let matchedProvider: (typeof providers)[number] | null = null;
  let gateway: ReturnType<typeof getGateway> | null = null;

  for (const prov of providers) {
    try {
      // Decrypt credentials to instantiate the gateway
      const decryptedCredentials = JSON.parse(
        decrypt(prov.credentials)
      ) as Record<string, unknown>;

      const metadata = prov.metadata as Record<string, unknown> | null;

      const gw = getGateway(
        prov.provider,
        decryptedCredentials,
        metadata,
        prov.webhookSecret ? decrypt(prov.webhookSecret) : undefined
      );

      if (gw.validateWebhook(headers, rawBody)) {
        matchedProvider = prov;
        gateway = gw;
        break;
      }
    } catch (err) {
      console.error(
        `[webhook] Error validating with provider ${prov.id}:`,
        err
      );
      // Continue trying other providers
    }
  }

  if (!matchedProvider || !gateway) {
    console.warn(`[webhook] Signature validation failed for all providers (param: ${providerParam})`);
    return NextResponse.json(
      { error: "invalid_signature" },
      { status: 401 }
    );
  }

  // 5. Parse the webhook event
  let event: WebhookEvent | null;
  try {
    event = gateway.parseWebhookEvent(rawBody);
  } catch (err) {
    console.error("[webhook] Failed to parse webhook event:", err);
    return NextResponse.json({ received: true, error: "parse_error" }, { status: 200 });
  }

  // Bug A fix: If provider returned null (unknown event type), acknowledge and skip
  if (!event) {
    return NextResponse.json({ received: true, skipped: "unknown_event_type" }, { status: 200 });
  }

  // 6. Find boleto by gatewayId
  const boleto = await prisma.boleto.findFirst({
    where: {
      gatewayId: event.gatewayId,
      providerId: matchedProvider.id,
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

  if (!boleto) {
    console.warn(
      `[webhook] Boleto not found for gatewayId: ${event.gatewayId}, provider: ${matchedProvider.id}`
    );
    // Return 200 to avoid infinite retries
    // Bug E fix: Fire-and-forget to prevent retry storm if audit log fails
    logAuditEvent({
      userId: "system",
      action: "STATUS_CHANGE",
      entity: "Webhook",
      entityId: event.gatewayId,
      dataAfter: {
        providerParam,
        providerId: matchedProvider.id,
        eventType: event.type,
        status: "boleto_not_found",
      },
      companyId: matchedProvider.companyId,
    }).catch(err => console.error("Audit log failed:", err));
    return NextResponse.json({ received: true, boleto: "not_found" }, { status: 200 });
  }

  // Bug #12 fix: Early return if event type is not in our status map
  const newBoletoStatus = WEBHOOK_TO_BOLETO_STATUS[event.type];
  if (!newBoletoStatus) {
    console.warn(`[webhook] Unknown event type: ${event.type}, skipping`);
    return NextResponse.json({ received: true, skipped: "unknown_event_type" }, { status: 200 });
  }

  // Bug #16 fix: Detect overpaid flag from rawEvent for downstream alerting
  const rawEvent = event.rawEvent as Record<string, unknown> | undefined;
  const isOverpaid = rawEvent?._isOverpaid === true;

  // Bug #3 fix: Wrap boleto + receivable updates in a transaction
  // Bug #4 fix: Use boletoId FK for direct join instead of heuristic matching
  // Bug G fix: Re-read boleto with SELECT FOR UPDATE inside transaction for serialization
  let updatedReceivableId: string | null = null;
  let previousStatus: BoletoStatus = boleto.status as BoletoStatus;
  let expectedAmountCents: number = 0;
  let paidAmount: number = 0;
  let overpaidDelta: number = 0;

  const txResult = await prisma.$transaction(async (tx) => {
    // Bug G fix: SELECT FOR UPDATE to prevent race condition between concurrent webhooks
    const lockedBoleto = await tx.$queryRaw<Array<{ id: string; status: string; value: string }>>`
      SELECT id, status, value FROM boletos WHERE id = ${boleto.id} FOR UPDATE
    `;

    if (!lockedBoleto[0]) {
      return { skipped: true, reason: "not_found" } as const;
    }

    const currentStatus = lockedBoleto[0].status as BoletoStatus;

    // Bug #3 fix: Idempotency — skip if already in target status (now inside lock)
    if (currentStatus === newBoletoStatus) {
      return { skipped: true, reason: "already_in_status" } as const;
    }

    previousStatus = currentStatus;
    expectedAmountCents = Math.round(Number(lockedBoleto[0].value) * CENTS_PER_UNIT);
    paidAmount = event.paidAmount ?? expectedAmountCents;
    overpaidDelta = isOverpaid ? paidAmount - expectedAmountCents : 0;

    // Update boleto status
    await tx.boleto.update({
      where: { id: boleto.id },
      data: { status: newBoletoStatus },
    });

    // If paid: find and update matching AccountReceivable via boletoId FK
    if (newBoletoStatus === BoletoStatus.PAID && boleto.proposal) {
      // Bug #4 fix: Direct lookup via boletoId FK — no heuristic matching
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
        // Fallback: try heuristic match for legacy receivables without boletoId
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
            boletoId: null, // Only match unlinked receivables
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
              boletoId: boleto.id, // Link for future lookups
            },
          });
          updatedReceivableId = legacyReceivable.id;
        }
      }
    }
    return { skipped: false } as const;
  });

  if (txResult.skipped) {
    console.log(`[webhook] Boleto ${boleto.id} skipped: ${txResult.reason}`);
    return NextResponse.json({ received: true, skipped: txResult.reason }, { status: 200 });
  }

  // Bug #16 fix: If overpaid, emit a prominent structured log + dedicated audit event
  // so it never passes unnoticed. This enables monitoring/alerting tools to trigger
  // refund workflows based on the OVERPAID audit action.
  if (isOverpaid) {
    console.warn(
      `[webhook] ⚠️ OVERPAID BOLETO DETECTED | boletoId=${boleto.id} | ` +
        `expected=${expectedAmountCents} | paid=${paidAmount} | delta=${overpaidDelta} | ` +
        `gatewayId=${event.gatewayId} | providerId=${matchedProvider.id} | ` +
        `companyId=${boleto.companyId} | receivableId=${updatedReceivableId ?? "none"}`
    );

    logAuditEvent({
      userId: "system",
      action: "STATUS_CHANGE",
      entity: "Boleto",
      entityId: boleto.id,
      dataAfter: {
        alert: "OVERPAID",
        expectedAmountCents, // in centavos
        paidAmount,
        overpaidDelta,
        gatewayId: event.gatewayId,
        providerId: matchedProvider.id,
        accountReceivableId: updatedReceivableId,
        message: `Boleto pago a maior: esperado R$${(expectedAmountCents / CENTS_PER_UNIT).toFixed(2)}, ` +
          `recebido R$${(paidAmount / CENTS_PER_UNIT).toFixed(2)}. Diferença: R$${(overpaidDelta / CENTS_PER_UNIT).toFixed(2)}. ` +
          `Verificar necessidade de devolução.`,
      },
      companyId: boleto.companyId,
    }).catch(err => console.error("Audit log failed:", err));
  }

  // 10. Log audit event
  // Bug E fix: Fire-and-forget to prevent retry storms
  logAuditEvent({
    userId: "system",
    action: "STATUS_CHANGE",
    entity: "Boleto",
    entityId: boleto.id,
    dataBefore: { status: previousStatus },
    dataAfter: {
      status: newBoletoStatus,
      webhookEvent: event.type,
      providerParam,
      providerId: matchedProvider.id,
      gatewayId: event.gatewayId,
      paidAt: event.paidAt?.toISOString() ?? null,
      paidAmount: event.paidAmount ?? null,
      accountReceivableId: updatedReceivableId,
      ...(isOverpaid ? { overpaid: true, overpaidDelta } : {}),
    },
    companyId: boleto.companyId,
  }).catch(err => console.error("Audit log failed:", err));

  console.log(
    `[webhook] Boleto ${boleto.id} updated: ${previousStatus} → ${newBoletoStatus}` +
      (updatedReceivableId ? ` | AR ${updatedReceivableId} → PAID` : "") +
      (isOverpaid ? ` | ⚠️ OVERPAID by ${overpaidDelta}` : "")
  );

  return NextResponse.json({ received: true }, { status: 200 });
}
