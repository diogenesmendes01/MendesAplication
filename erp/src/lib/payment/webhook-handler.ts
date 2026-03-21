import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/audit";
import type { WebhookEvent } from "@/lib/payment/types";
import { BoletoStatus, PaymentStatus } from "@prisma/client";
import {
import { logger } from "@/lib/logger";
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
// Result type
// ---------------------------------------------------------------------------

export interface WebhookProcessResult {
  /** Whether the event was processed (boleto found and updated) */
  processed: boolean;
  /** Reason for skip/failure */
  reason?: "boleto_not_found" | "unknown_event_type" | "already_in_status" | "not_found_in_tx";
  /** Updated boleto ID, if processed */
  boletoId?: string;
  /** Previous boleto status, if processed */
  previousStatus?: BoletoStatus;
  /** New boleto status, if processed */
  newStatus?: BoletoStatus;
  /** Updated AccountReceivable ID, if any */
  accountReceivableId?: string | null;
}

// ---------------------------------------------------------------------------
// processBoletoWebhookEvent
//
// Shared helper that handles the core boleto + receivable update logic for
// any provider's webhook. Extracted from the Santander webhook route to
// avoid duplicating this logic across provider-specific routes.
//
// Includes: idempotency check, SELECT FOR UPDATE, boleto status update,
// AccountReceivable update (direct FK + heuristic fallback), and audit log.
// ---------------------------------------------------------------------------

/**
 * Processes a parsed webhook event: finds the boleto, updates its status,
 * and reconciles the linked AccountReceivable if applicable.
 *
 * @param event - The parsed WebhookEvent from the provider
 * @param providerId - The PaymentProvider.id that received this webhook
 * @param companyId - The company that owns this provider
 * @param source - Identifier for audit logs (e.g. "santander-webhook")
 */
export async function processBoletoWebhookEvent(
  event: WebhookEvent,
  providerId: string,
  companyId: string,
  source: string,
): Promise<WebhookProcessResult> {
  // 1. Map event type to boleto status
  const newBoletoStatus = WEBHOOK_TO_BOLETO_STATUS[event.type];
  if (!newBoletoStatus) {
    return { processed: false, reason: "unknown_event_type" };
  }

  // 2. Find boleto by gatewayId
  // The gatewayId from webhook may be partial (%.covenantCode.bankNumber)
  // or full (nsuCode.nsuDate.ENV.covenantCode.bankNumber)
  let boleto;
  if (event.gatewayId.startsWith("%.")) {
    // Partial gatewayId — search by suffix
    const suffix = event.gatewayId.slice(2); // Remove "%."
    boleto = await prisma.boleto.findFirst({
      where: {
        gatewayId: { endsWith: `.${suffix}` },
        providerId,
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
        providerId,
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
    // Log audit event for debugging — fire-and-forget
    logAuditEvent({
      userId: "system",
      action: "STATUS_CHANGE",
      entity: "Webhook",
      entityId: event.gatewayId,
      dataAfter: {
        source,
        providerId,
        eventType: event.type,
        status: "boleto_not_found",
        rawGatewayId: event.gatewayId,
      },
      companyId,
    }).catch((err) => logger.error("Audit log failed:", err));

    return { processed: false, reason: "boleto_not_found" };
  }

  // 3. Update boleto and receivable in a transaction
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
      return { skipped: true, reason: "not_found_in_tx" as const };
    }

    const currentStatus = lockedBoleto[0].status as BoletoStatus;

    // Idempotency — skip if already in target status
    if (currentStatus === newBoletoStatus) {
      return { skipped: true, reason: "already_in_status" as const };
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
    return {
      processed: false,
      reason: txResult.reason as WebhookProcessResult["reason"],
      boletoId: boleto.id,
    };
  }

  // 4. Log audit event — fire-and-forget
  logAuditEvent({
    userId: "system",
    action: "STATUS_CHANGE",
    entity: "Boleto",
    entityId: boleto.id,
    dataBefore: { status: previousStatus },
    dataAfter: {
      status: newBoletoStatus,
      webhookEvent: event.type,
      source,
      providerId,
      gatewayId: event.gatewayId,
      paidAt: event.paidAt?.toISOString() ?? null,
      paidAmount: event.paidAmount ?? null,
      accountReceivableId: updatedReceivableId,
    },
    companyId: boleto.companyId,
  }).catch((err) => logger.error("Audit log failed:", err));

  return {
    processed: true,
    boletoId: boleto.id,
    previousStatus,
    newStatus: newBoletoStatus,
    accountReceivableId: updatedReceivableId,
  };
}
