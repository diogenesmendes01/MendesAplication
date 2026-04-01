/**
 * Centralized KPI cache module.
 *
 * Consolidates the 10+ parallel count queries previously scattered across
 * dashboard-actions.ts, getSlaAlertCounts, and getTicketTabCounts into a
 * single cache entry per company with a 15-second TTL.
 *
 * SLA configuration is cached separately with a 5-minute TTL (configs
 * change rarely).
 */

import { prisma } from "@/lib/prisma";
import { getSlaStatus } from "@/lib/sla";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompanyKpiSummary {
  // Dashboard fields
  openCount: number;
  inProgressCount: number;
  waitingClientCount: number;
  resolvedTodayCount: number;
  slaBreachedCount: number;
  slaAtRiskCount: number;
  pendingRefundsCount: number;
  avgResponseTimeMinutes: number;
  ticketsByChannel: { channel: string; count: number }[];
  ticketsByPriority: { priority: string; count: number }[];
}

// ---------------------------------------------------------------------------
// SLA config cache (5-minute TTL)
// ---------------------------------------------------------------------------

const slaConfigCache = new Map<
  string,
  {
    data: { priority: string | null; stage: string; alertBeforeMinutes: number }[];
    timestamp: number;
  }
>();
const SLA_CONFIG_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchSlaConfigs(companyId: string) {
  const cached = slaConfigCache.get(companyId);
  if (cached && Date.now() - cached.timestamp < SLA_CONFIG_TTL) {
    return cached.data;
  }
  const configs = await prisma.slaConfig.findMany({
    where: { companyId, type: "TICKET" },
    select: { priority: true, stage: true, alertBeforeMinutes: true },
  });
  slaConfigCache.set(companyId, { data: configs, timestamp: Date.now() });
  return configs;
}

// ---------------------------------------------------------------------------
// KPI cache (15-second TTL)
// ---------------------------------------------------------------------------

const kpiCache = new Map<
  string,
  { data: CompanyKpiSummary; timestamp: number }
>();
const KPI_CACHE_TTL = 15 * 1000; // 15 seconds

/**
 * Invalidate the KPI cache for a given company. Call this after any mutation
 * that changes ticket/refund state.
 */
export function invalidateKpiCache(companyId: string): void {
  kpiCache.delete(companyId);
}

/**
 * Get all KPI metrics for a company. Returns a cached result if available
 * (15s TTL), otherwise runs all queries in parallel.
 */
export async function getCompanyKpis(
  companyId: string
): Promise<CompanyKpiSummary> {
  const cached = kpiCache.get(companyId);
  if (cached && Date.now() - cached.timestamp < KPI_CACHE_TTL) {
    return cached.data;
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const activeStatuses = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] as const;

  // SLA configs cached separately — rarely change
  const slaConfigs = await fetchSlaConfigs(companyId);

  const [
    openCount,
    inProgressCount,
    waitingClientCount,
    resolvedTodayCount,
    slaBreachedCount,
    pendingRefundsCount,
    ticketsWithSla,
    priorityGroups,
    channelGroupsRaw,
    avgResponseRaw,
  ] = await Promise.all([
    prisma.ticket.count({
      where: { companyId, status: "OPEN" },
    }),
    prisma.ticket.count({
      where: { companyId, status: "IN_PROGRESS" },
    }),
    prisma.ticket.count({
      where: { companyId, status: "WAITING_CLIENT" },
    }),
    prisma.ticket.count({
      where: {
        companyId,
        status: "RESOLVED",
        updatedAt: { gte: startOfToday },
      },
    }),
    prisma.ticket.count({
      where: {
        companyId,
        slaBreached: true,
        status: { in: [...activeStatuses] },
      },
    }),
    prisma.refund.count({
      where: { companyId, status: "AWAITING_APPROVAL" },
    }),
    // Active tickets with SLA deadlines for at-risk calculation
    prisma.ticket.findMany({
      where: {
        companyId,
        status: { in: [...activeStatuses] },
        slaBreached: false,
        OR: [
          { slaFirstReply: { not: null } },
          { slaResolution: { not: null } },
        ],
      },
      select: {
        priority: true,
        slaFirstReply: true,
        slaResolution: true,
      },
    }),
    // Group by priority (active tickets)
    prisma.ticket.groupBy({
      by: ["priority"],
      where: { companyId, status: { in: [...activeStatuses] } },
      _count: true,
    }),
    // Group by channel type via raw SQL (join with channels table)
    prisma.$queryRaw<{ channel: string; count: bigint }[]>`
      SELECT COALESCE(c."type"::text, 'WEB') as channel, COUNT(*)::bigint as count
      FROM tickets t
      LEFT JOIN channels c ON t."channelId" = c.id
      WHERE t."companyId" = ${companyId}
        AND t.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT')
      GROUP BY COALESCE(c."type"::text, 'WEB')
    `,
    // Average response time (minutes from ticket creation to first message)
    prisma.$queryRaw<{ avg_minutes: number | null }[]>`
      SELECT AVG(response_minutes) as avg_minutes
      FROM (
        SELECT EXTRACT(EPOCH FROM (
          (SELECT MIN(tm."createdAt") FROM ticket_messages tm WHERE tm."ticketId" = t.id) - t."createdAt"
        )) / 60 as response_minutes
        FROM tickets t
        WHERE t."companyId" = ${companyId}
          AND EXISTS (SELECT 1 FROM ticket_messages tm WHERE tm."ticketId" = t.id)
      ) sub
      WHERE response_minutes IS NOT NULL AND response_minutes >= 0
    `,
  ]);

  // Calculate SLA at-risk count using alert thresholds from SlaConfig
  const alertLookup = new Map<string, number>();
  for (const config of slaConfigs) {
    alertLookup.set(
      `${config.priority}_${config.stage}`,
      config.alertBeforeMinutes
    );
  }

  let slaAtRiskCount = 0;
  for (const ticket of ticketsWithSla) {
    let isAtRisk = false;
    if (ticket.slaFirstReply) {
      const alertMinutes =
        alertLookup.get(`${ticket.priority}_first_reply`) ?? 30;
      if (getSlaStatus(ticket.slaFirstReply, alertMinutes) === "at_risk") {
        isAtRisk = true;
      }
    }
    if (!isAtRisk && ticket.slaResolution) {
      const alertMinutes =
        alertLookup.get(`${ticket.priority}_resolution`) ?? 30;
      if (getSlaStatus(ticket.slaResolution, alertMinutes) === "at_risk") {
        isAtRisk = true;
      }
    }
    if (isAtRisk) slaAtRiskCount++;
  }

  // Process ticketsByChannel from raw query
  const ticketsByChannel = channelGroupsRaw.map((g) => ({
    channel: g.channel,
    count: Number(g.count),
  }));

  // Process ticketsByPriority from groupBy
  const ticketsByPriority = priorityGroups.map((g) => ({
    priority: g.priority,
    count: g._count,
  }));

  // Process average response time
  const avgResponseTimeMinutes = avgResponseRaw[0]?.avg_minutes
    ? Math.round(Number(avgResponseRaw[0].avg_minutes))
    : 0;

  const result: CompanyKpiSummary = {
    openCount,
    inProgressCount,
    waitingClientCount,
    resolvedTodayCount,
    slaBreachedCount,
    slaAtRiskCount,
    pendingRefundsCount,
    avgResponseTimeMinutes,
    ticketsByChannel,
    ticketsByPriority,
  };

  kpiCache.set(companyId, { data: result, timestamp: Date.now() });

  return result;
}
