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
      slaAtRisk: false,
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
      slaAtRisk: false,
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
      slaAtRisk: false,
    },
  });

  if (refundBreached.count > 0) {
    console.log(
      `[sla-check] Marked ${refundBreached.count} refund(s) as SLA breached`
    );
  }

  // --- Tickets: mark at-risk where deadline is within alertBeforeMinutes ---
  const slaConfigs = await prisma.slaConfig.findMany({
    where: { type: "TICKET" },
    select: {
      companyId: true,
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
  const atRiskCandidates = await prisma.ticket.findMany({
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
      slaAtRisk: true,
    },
  });

  const ticketsToMarkAtRisk: string[] = [];
  const ticketsToUnmarkAtRisk: string[] = [];

  for (const ticket of atRiskCandidates) {
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

    const isAtRisk = !!(firstReplyAtRisk || resolutionAtRisk);

    if (isAtRisk && !ticket.slaAtRisk) {
      ticketsToMarkAtRisk.push(ticket.id);
    } else if (!isAtRisk && ticket.slaAtRisk) {
      ticketsToUnmarkAtRisk.push(ticket.id);
    }
  }

  if (ticketsToMarkAtRisk.length > 0) {
    await prisma.ticket.updateMany({
      where: { id: { in: ticketsToMarkAtRisk } },
      data: { slaAtRisk: true },
    });
    console.log(
      `[sla-check] Marked ${ticketsToMarkAtRisk.length} ticket(s) as at risk of SLA breach`
    );
  }

  if (ticketsToUnmarkAtRisk.length > 0) {
    await prisma.ticket.updateMany({
      where: { id: { in: ticketsToUnmarkAtRisk } },
      data: { slaAtRisk: false },
    });
  }

  // --- Refunds: mark at-risk ---
  const atRiskRefundCandidates = await prisma.refund.findMany({
    where: {
      status: { in: ["AWAITING_APPROVAL", "APPROVED", "PROCESSING"] },
      slaBreached: false,
      slaDeadline: { not: null },
    },
    select: {
      id: true,
      companyId: true,
      slaDeadline: true,
      slaAtRisk: true,
    },
  });

  const refundsToMarkAtRisk: string[] = [];
  const refundsToUnmarkAtRisk: string[] = [];

  for (const refund of atRiskRefundCandidates) {
    const alertMinutes = alertMinutesMap.get(refund.companyId) ?? 30;
    const alertThreshold = new Date(now.getTime() + alertMinutes * 60_000);

    const isAtRisk =
      refund.slaDeadline !== null &&
      refund.slaDeadline <= alertThreshold &&
      refund.slaDeadline > now;

    if (isAtRisk && !refund.slaAtRisk) {
      refundsToMarkAtRisk.push(refund.id);
    } else if (!isAtRisk && refund.slaAtRisk) {
      refundsToUnmarkAtRisk.push(refund.id);
    }
  }

  if (refundsToMarkAtRisk.length > 0) {
    await prisma.refund.updateMany({
      where: { id: { in: refundsToMarkAtRisk } },
      data: { slaAtRisk: true },
    });
    console.log(
      `[sla-check] Marked ${refundsToMarkAtRisk.length} refund(s) as at risk of SLA breach`
    );
  }

  if (refundsToUnmarkAtRisk.length > 0) {
    await prisma.refund.updateMany({
      where: { id: { in: refundsToUnmarkAtRisk } },
      data: { slaAtRisk: false },
    });
  }

  const totalBreaches =
    firstReplyBreached.count + resolutionBreached.count + refundBreached.count;
  const totalAtRisk = ticketsToMarkAtRisk.length + refundsToMarkAtRisk.length;
  if (totalBreaches === 0 && totalAtRisk === 0) {
    console.log("[sla-check] All SLAs healthy");
  }
}
