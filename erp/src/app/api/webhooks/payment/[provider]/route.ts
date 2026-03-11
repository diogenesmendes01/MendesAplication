import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { getGateway } from "@/lib/payment/factory";
import { logAuditEvent } from "@/lib/audit";
import type { WebhookEvent } from "@/lib/payment/types";
import { BoletoStatus, PaymentStatus } from "@prisma/client";

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
        prov.webhookSecret ?? undefined
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
  let event: WebhookEvent;
  try {
    event = gateway.parseWebhookEvent(rawBody);
  } catch (err) {
    console.error("[webhook] Failed to parse webhook event:", err);
    return NextResponse.json({ received: true, error: "parse_error" }, { status: 200 });
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
    await logAuditEvent({
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
    });
    return NextResponse.json({ received: true, boleto: "not_found" }, { status: 200 });
  }

  // Bug #12 fix: Early return if event type is not in our status map
  const newBoletoStatus = WEBHOOK_TO_BOLETO_STATUS[event.type];
  if (!newBoletoStatus) {
    console.warn(`[webhook] Unknown event type: ${event.type}, skipping`);
    return NextResponse.json({ received: true, skipped: "unknown_event_type" }, { status: 200 });
  }

  const previousStatus = boleto.status;

  // Bug #3 fix: Idempotency — skip if already in target status
  if (boleto.status === newBoletoStatus) {
    console.log(`[webhook] Boleto ${boleto.id} already in status ${newBoletoStatus}, skipping`);
    return NextResponse.json({ received: true, skipped: "already_in_status" }, { status: 200 });
  }

  // Bug #3 fix: Wrap boleto + receivable updates in a transaction
  // Bug #4 fix: Use boletoId FK for direct join instead of heuristic matching
  let updatedReceivableId: string | null = null;

  await prisma.$transaction(async (tx) => {
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
        const tolerance = 0.01;
        const dueDateWindow = 15;
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
  });

  // 10. Log audit event
  await logAuditEvent({
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
    },
    companyId: boleto.companyId,
  });

  console.log(
    `[webhook] Boleto ${boleto.id} updated: ${previousStatus} → ${newBoletoStatus}` +
      (updatedReceivableId ? ` | AR ${updatedReceivableId} → PAID` : "")
  );

  return NextResponse.json({ received: true }, { status: 200 });
}
