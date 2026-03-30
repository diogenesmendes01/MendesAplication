import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import type { RefundStatus, TicketPriority } from "@prisma/client";
import { logger } from "@/lib/logger";
import { checkSlaViolations } from "@/lib/sla-engine";

const DEFAULT_ALERT_MINUTES = 30;
const ANY_PRIORITY_KEY = "__ANY__";

type SlaAlertConfig = { companyId: string; priority: TicketPriority | null; stage: string; alertBeforeMinutes: number };
type AlertLookup = Map<string, Map<string, Map<string, number>>>;

function buildAlertLookup(configs: SlaAlertConfig[]): AlertLookup {
  const lookup: AlertLookup = new Map();
  for (const cfg of configs) {
    const cm = lookup.get(cfg.companyId) ?? new Map<string, Map<string, number>>();
    lookup.set(cfg.companyId, cm);
    const sm = cm.get(cfg.stage) ?? new Map<string, number>();
    cm.set(cfg.stage, sm);
    sm.set(cfg.priority ?? ANY_PRIORITY_KEY, cfg.alertBeforeMinutes);
  }
  return lookup;
}

function resolveAlertMinutes(lookup: AlertLookup, companyId: string, stage: string, priority: TicketPriority | null | undefined): number {
  const cm = lookup.get(companyId);
  if (!cm) return DEFAULT_ALERT_MINUTES;
  const sm = cm.get(stage);
  if (!sm) return DEFAULT_ALERT_MINUTES;
  return sm.get(priority ?? ANY_PRIORITY_KEY) ?? sm.get(ANY_PRIORITY_KEY) ?? DEFAULT_ALERT_MINUTES;
}

function inferRefundStage(status: RefundStatus): string {
  switch (status) { case "AWAITING_APPROVAL": return "approval"; case "APPROVED": case "PROCESSING": return "execution"; default: return "total"; }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function processSlaCheck(job: Job): Promise<void> {
  const now = new Date();

  // Ticket SLA via engine
  try {
    const result = await checkSlaViolations();
    if (result.breached > 0 || result.atRisk > 0) {
      logger.info(`[sla-check] SLA engine: ${result.breached} breached, ${result.atRisk} at risk`);
    }
  } catch (err) {
    logger.error("[sla-check] SLA engine error:" + " " + String(err));
    // Fallback
    await prisma.ticket.updateMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] }, slaFirstReply: { lt: now }, slaBreached: false },
      data: { slaBreached: true, slaAtRisk: false },
    });
  }

  // Refunds
  const refundBreached = await prisma.refund.updateMany({
    where: { status: { in: ["AWAITING_APPROVAL", "APPROVED", "PROCESSING"] }, slaDeadline: { lt: now }, slaBreached: false },
    data: { slaBreached: true, slaAtRisk: false },
  });
  if (refundBreached.count > 0) logger.info(`[sla-check] ${refundBreached.count} refund(s) breached`);

  const refundLookup = await prisma.slaConfig
    .findMany({ where: { type: "REFUND" }, select: { companyId: true, priority: true, stage: true, alertBeforeMinutes: true } })
    .then((c) => buildAlertLookup(c as SlaAlertConfig[]));

  const refundCandidates = await prisma.refund.findMany({
    where: { status: { in: ["AWAITING_APPROVAL", "APPROVED", "PROCESSING"] }, slaBreached: false, slaDeadline: { not: null } },
    select: { id: true, companyId: true, slaDeadline: true, slaAtRisk: true, status: true },
  });

  const toMark: string[] = [];
  const toUnmark: string[] = [];
  for (const r of refundCandidates) {
    const stage = inferRefundStage(r.status);
    const alertMin = resolveAlertMinutes(refundLookup, r.companyId, stage, null);
    const threshold = new Date(now.getTime() + alertMin * 60_000);
    const atRisk = r.slaDeadline !== null && r.slaDeadline <= threshold && r.slaDeadline > now;
    if (atRisk && !r.slaAtRisk) toMark.push(r.id);
    else if (!atRisk && r.slaAtRisk) toUnmark.push(r.id);
  }

  if (toMark.length > 0) { await prisma.refund.updateMany({ where: { id: { in: toMark } }, data: { slaAtRisk: true } }); logger.info(`[sla-check] ${toMark.length} refund(s) at risk`); }
  if (toUnmark.length > 0) await prisma.refund.updateMany({ where: { id: { in: toUnmark } }, data: { slaAtRisk: false } });

  // Reclame Aqui SLA check (10 business days)
  try {
    const raResult = await checkRaSlaDeadlines();
    if (raResult.breached > 0 || raResult.atRisk > 0) {
      logger.info(`[sla-check] RA SLA: ${raResult.breached} breached, ${raResult.atRisk} at risk`);
    }
  } catch (err) {
    logger.error("[sla-check] RA SLA check error:" + " " + String(err));
  }
}

// ---------------------------------------------------------------------------
// Reclame Aqui SLA (10 business days) — appended to processSlaCheck
// ---------------------------------------------------------------------------

import { sseBus } from "@/lib/sse";
import { getRaBusinessDaysRemaining } from "./reclameaqui-inbound";

/**
 * Check RA SLA deadlines and emit alerts.
 * Called at the end of processSlaCheck.
 */
export async function checkRaSlaDeadlines(): Promise<{ atRisk: number; breached: number }> {
  const now = new Date();
  let atRisk = 0;
  let breached = 0;

  const raTickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
      raSlaDeadline: { not: null },
      raExternalId: { not: null },
    },
    select: {
      id: true,
      companyId: true,
      raSlaDeadline: true,
      slaBreached: true,
      slaAtRisk: true,
      subject: true,
    },
  });

  for (const ticket of raTickets) {
    if (!ticket.raSlaDeadline) continue;

    const daysRemaining = getRaBusinessDaysRemaining(ticket.raSlaDeadline, now);

    if (daysRemaining <= 0 && !ticket.slaBreached) {
      // RA SLA breached
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { slaBreached: true, slaAtRisk: false },
      });

      sseBus.publish(`sac:${ticket.companyId}`, "ra-sla-breach", {
        ticketId: ticket.id,
        subject: ticket.subject,
        daysOverdue: Math.abs(daysRemaining),
      });

      try {
        await prisma.auditLog.create({
          data: {
            userId: null,
            action: "RA_SLA_BREACHED",
            entity: "Ticket",
            entityId: ticket.id,
            companyId: ticket.companyId,
            dataAfter: { daysOverdue: Math.abs(daysRemaining), deadline: ticket.raSlaDeadline.toISOString() },
          },
        });
      } catch (auditErr) {
        logger.error({ metric: "audit.create.failure", action: "RA_SLA_BREACHED", ticketId: ticket.id, err: String(auditErr) }, "[sla-check] Failed to create audit log for RA_SLA_BREACHED");
      }

      logger.warn(`[sla-check] RA SLA breached: ticket=${ticket.id} overdue=${Math.abs(daysRemaining)} days`);
      breached++;
    } else if (daysRemaining > 0 && daysRemaining <= 2 && !ticket.slaAtRisk && !ticket.slaBreached) {
      // RA SLA at risk (2 business days remaining)
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { slaAtRisk: true },
      });

      sseBus.publish(`sac:${ticket.companyId}`, "ra-sla-at-risk", {
        ticketId: ticket.id,
        subject: ticket.subject,
        daysRemaining,
      });

      try {
        await prisma.auditLog.create({
          data: {
            userId: null,
            action: "RA_SLA_AT_RISK",
            entity: "Ticket",
            entityId: ticket.id,
            companyId: ticket.companyId,
            dataAfter: { daysRemaining, deadline: ticket.raSlaDeadline.toISOString() },
          },
        });
      } catch (auditErr) {
        logger.error({ metric: "audit.create.failure", action: "RA_SLA_AT_RISK", ticketId: ticket.id, err: String(auditErr) }, "[sla-check] Failed to create audit log for RA_SLA_AT_RISK");
      }

      logger.info(`[sla-check] RA SLA at risk: ticket=${ticket.id} daysRemaining=${daysRemaining}`);
      atRisk++;
    }
  }

  return { atRisk, breached };
}
