import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// SLA Check Worker
// Runs every 1 minute to detect breached and at-risk SLAs for tickets and refunds.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function processSlaCheck(job: Job): Promise<void> {
  const now = new Date();

  // --- Tickets: mark slaBreached where deadline has passed ---
  // Check slaFirstReply breaches
  const firstReplyBreached = await prisma.ticket.updateMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
      slaFirstReply: { lt: now },
      slaBreached: false,
    },
    data: {
      slaBreached: true,
    },
  });

  if (firstReplyBreached.count > 0) {
    console.log(
      `[sla-check] Marked ${firstReplyBreached.count} ticket(s) as SLA breached (first reply deadline passed)`
    );
  }

  // Check slaResolution breaches
  const resolutionBreached = await prisma.ticket.updateMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
      slaResolution: { lt: now },
      slaBreached: false,
    },
    data: {
      slaBreached: true,
    },
  });

  if (resolutionBreached.count > 0) {
    console.log(
      `[sla-check] Marked ${resolutionBreached.count} ticket(s) as SLA breached (resolution deadline passed)`
    );
  }

  // --- Refunds: mark slaBreached where deadline has passed ---
  const refundBreached = await prisma.refund.updateMany({
    where: {
      status: { in: ["AWAITING_APPROVAL", "APPROVED", "PROCESSING"] },
      slaDeadline: { lt: now },
      slaBreached: false,
    },
    data: {
      slaBreached: true,
    },
  });

  if (refundBreached.count > 0) {
    console.log(
      `[sla-check] Marked ${refundBreached.count} refund(s) as SLA breached`
    );
  }

  // --- Log at-risk tickets (deadline within alertBeforeMinutes) ---
  // Fetch SLA configs to know alert thresholds per company
  const slaConfigs = await prisma.slaConfig.findMany({
    where: { type: "TICKET" },
    select: {
      companyId: true,
      stage: true,
      alertBeforeMinutes: true,
    },
  });

  // Build a map of companyId -> max alertBeforeMinutes for quick lookup
  const alertMinutesMap = new Map<string, number>();
  for (const cfg of slaConfigs) {
    const current = alertMinutesMap.get(cfg.companyId) ?? 0;
    if (cfg.alertBeforeMinutes > current) {
      alertMinutesMap.set(cfg.companyId, cfg.alertBeforeMinutes);
    }
  }

  // For tickets not yet breached, check if they are at risk
  const atRiskTickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
      slaBreached: false,
      OR: [
        { slaFirstReply: { not: null } },
        { slaResolution: { not: null } },
      ],
    },
    select: {
      id: true,
      companyId: true,
      slaFirstReply: true,
      slaResolution: true,
    },
  });

  let atRiskCount = 0;
  for (const ticket of atRiskTickets) {
    const alertMinutes = alertMinutesMap.get(ticket.companyId) ?? 30;
    const alertThreshold = new Date(now.getTime() + alertMinutes * 60_000);

    const firstReplyAtRisk =
      ticket.slaFirstReply &&
      ticket.slaFirstReply <= alertThreshold &&
      ticket.slaFirstReply > now;
    const resolutionAtRisk =
      ticket.slaResolution &&
      ticket.slaResolution <= alertThreshold &&
      ticket.slaResolution > now;

    if (firstReplyAtRisk || resolutionAtRisk) {
      atRiskCount++;
    }
  }

  if (atRiskCount > 0) {
    console.log(
      `[sla-check] ${atRiskCount} ticket(s) at risk of SLA breach`
    );
  }

  // Log at-risk refunds
  const atRiskRefunds = await prisma.refund.findMany({
    where: {
      status: { in: ["AWAITING_APPROVAL", "APPROVED", "PROCESSING"] },
      slaBreached: false,
      slaDeadline: { not: null },
    },
    select: {
      id: true,
      companyId: true,
      slaDeadline: true,
    },
  });

  let atRiskRefundCount = 0;
  for (const refund of atRiskRefunds) {
    const alertMinutes = alertMinutesMap.get(refund.companyId) ?? 30;
    const alertThreshold = new Date(now.getTime() + alertMinutes * 60_000);

    if (
      refund.slaDeadline &&
      refund.slaDeadline <= alertThreshold &&
      refund.slaDeadline > now
    ) {
      atRiskRefundCount++;
    }
  }

  if (atRiskRefundCount > 0) {
    console.log(
      `[sla-check] ${atRiskRefundCount} refund(s) at risk of SLA breach`
    );
  }

  const totalBreaches =
    firstReplyBreached.count + resolutionBreached.count + refundBreached.count;
  if (totalBreaches === 0 && atRiskCount === 0 && atRiskRefundCount === 0) {
    console.log("[sla-check] All SLAs healthy");
  }
}
