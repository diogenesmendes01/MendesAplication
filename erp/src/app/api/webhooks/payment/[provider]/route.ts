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
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerType } = await params;

  // 1. Read raw body (needed for signature validation)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // 2. Extract headers as plain object
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // 3. Find active PaymentProviders of this type
  const providers = await prisma.paymentProvider.findMany({
    where: {
      provider: providerType,
      isActive: true,
    },
  });

  if (providers.length === 0) {
    console.warn(`[webhook] No active providers found for type: ${providerType}`);
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
    console.warn(`[webhook] Signature validation failed for all ${providerType} providers`);
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
        providerType,
        providerId: matchedProvider.id,
        eventType: event.type,
        status: "boleto_not_found",
      },
      companyId: matchedProvider.companyId,
    });
    return NextResponse.json({ received: true, boleto: "not_found" }, { status: 200 });
  }

  // 7. Map event type to BoletoStatus
  const newBoletoStatus = WEBHOOK_TO_BOLETO_STATUS[event.type];
  const previousStatus = boleto.status;

  // 8. Update boleto status
  await prisma.boleto.update({
    where: { id: boleto.id },
    data: {
      status: newBoletoStatus,
    },
  });

  // 9. If paid: find and update matching AccountReceivable
  let updatedReceivableId: string | null = null;

  if (newBoletoStatus === BoletoStatus.PAID && boleto.proposal) {
    const boletoValue = Number(boleto.value);
    const tolerance = 0.01; // R$ 0.01 tolerance for Decimal comparison
    const dueDateWindow = 15; // days tolerance for due date matching

    const dueDateMin = new Date(boleto.dueDate);
    dueDateMin.setDate(dueDateMin.getDate() - dueDateWindow);
    const dueDateMax = new Date(boleto.dueDate);
    dueDateMax.setDate(dueDateMax.getDate() + dueDateWindow);

    const receivable = await prisma.accountReceivable.findFirst({
      where: {
        companyId: boleto.companyId,
        clientId: boleto.proposal.clientId,
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
      orderBy: {
        dueDate: "asc",
      },
    });

    if (receivable) {
      await prisma.accountReceivable.update({
        where: { id: receivable.id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: event.paidAt ?? new Date(),
        },
      });
      updatedReceivableId = receivable.id;
    }
  }

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
      providerType,
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
