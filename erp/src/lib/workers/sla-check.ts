import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import type { RefundStatus, TicketPriority } from "@prisma/client";
import { logger } from "@/lib/logger";

const DEFAULT_ALERT_MINUTES = 30;
const ANY_PRIORITY_KEY = "__ANY__";

type SlaAlertConfig = {
  companyId: string;
  priority: TicketPriority | null;
  stage: string;
  alertBeforeMinutes: number;
};

type AlertLookup = Map<string, Map<string, Map<string, number>>>;

function buildAlertLookup(configs: SlaAlertConfig[]): AlertLookup {
  const lookup: AlertLookup = new Map();
  for (const cfg of configs) {
    const companyMap =
      lookup.get(cfg.companyId) ?? new Map<string, Map<string, number>>();
    lookup.set(cfg.companyId, companyMap);

    const stageMap =
      companyMap.get(cfg.stage) ?? new Map<string, number>();
    companyMap.set(cfg.stage, stageMap);

    const priorityKey = cfg.priority ?? ANY_PRIORITY_KEY;
    stageMap.set(priorityKey, cfg.alertBeforeMinutes);
  }
  return lookup;
}

function resolveAlertMinutes(
  lookup: AlertLookup,
  companyId: string,
  stage: string,
  priority: TicketPriority | null | undefined
): number {
  const companyMap = lookup.get(companyId);
  if (!companyMap) return DEFAULT_ALERT_MINUTES;
  const stageMap = companyMap.get(stage);
  if (!stageMap) return DEFAULT_ALERT_MINUTES;

  const priorityKey = priority ?? ANY_PRIORITY_KEY;
  return (
    stageMap.get(priorityKey) ??
    stageMap.get(ANY_PRIORITY_KEY) ??
    DEFAULT_ALERT_MINUTES
  );
}

function inferRefundStage(status: RefundStatus): string {
  switch (status) {
    case "AWAITING_APPROVAL":
      return "approval";
    case "APPROVED":
    case "PROCESSING":
      return "execution";
    default:
      return "total";
  }
}

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
    logger.info(
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
    logger.info(
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
    logger.info(
      `[sla-check] Marked ${refundBreached.count} refund(s) as SLA breached`
    );
  }

  const [ticketAlertLookup, refundAlertLookup] = await Promise.all([
    prisma.slaConfig
      .findMany({
        where: { type: "TICKET" },
        select: {
          companyId: true,
          priority: true,
          stage: true,
          alertBeforeMinutes: true,
        },
      })
      .then((configs) => buildAlertLookup(configs as SlaAlertConfig[])),
    prisma.slaConfig
      .findMany({
        where: { type: "REFUND" },
        select: {
          companyId: true,
          priority: true,
          stage: true,
          alertBeforeMinutes: true,
        },
      })
      .then((configs) => buildAlertLookup(configs as SlaAlertConfig[])),
  ]);

  // --- Tickets: mark at-risk where deadline is within alertBeforeMinutes ---

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
      priority: true,
      slaFirstReply: true,
      slaResolution: true,
      slaAtRisk: true,
    },
  });

  const ticketsToMarkAtRisk: string[] = [];
  const ticketsToUnmarkAtRisk: string[] = [];

  for (const ticket of atRiskCandidates) {
    let isAtRisk = false;

    if (ticket.slaFirstReply) {
      const alertMinutes = resolveAlertMinutes(
        ticketAlertLookup,
        ticket.companyId,
        "first_reply",
        ticket.priority
      );
      const threshold = new Date(now.getTime() + alertMinutes * 60_000);
      if (ticket.slaFirstReply <= threshold && ticket.slaFirstReply > now) {
        isAtRisk = true;
      }
    }

    if (!isAtRisk && ticket.slaResolution) {
      const alertMinutes = resolveAlertMinutes(
        ticketAlertLookup,
        ticket.companyId,
        "resolution",
        ticket.priority
      );
      const threshold = new Date(now.getTime() + alertMinutes * 60_000);
      if (ticket.slaResolution <= threshold && ticket.slaResolution > now) {
        isAtRisk = true;
      }
    }

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
    logger.info(
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
      status: true,
    },
  });

  const refundsToMarkAtRisk: string[] = [];
  const refundsToUnmarkAtRisk: string[] = [];

  for (const refund of atRiskRefundCandidates) {
    const stage = inferRefundStage(refund.status);
    const alertMinutes = resolveAlertMinutes(
      refundAlertLookup,
      refund.companyId,
      stage,
      null
    );
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
    logger.info(
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
    logger.info("[sla-check] All SLAs healthy");
  }
}
