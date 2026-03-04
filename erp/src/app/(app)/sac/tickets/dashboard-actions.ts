"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { getSlaStatus } from "@/lib/sla";

// In-memory SLA config cache — configs change rarely, fetched frequently
const slaConfigCache = new Map<string, { data: { priority: string | null; stage: string; alertBeforeMinutes: number }[]; timestamp: number }>();
const SLA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// In-memory dashboard cache — avoids re-running 10 parallel queries on every call
const dashboardCache = new Map<string, { data: TicketDashboard; timestamp: number }>();
const DASHBOARD_CACHE_TTL = 30 * 1000; // 30 seconds

async function fetchSlaConfigs(companyId: string) {
  const cached = slaConfigCache.get(companyId);
  if (cached && Date.now() - cached.timestamp < SLA_CACHE_TTL) {
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
// Types
// ---------------------------------------------------------------------------

export interface TicketDashboard {
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
// Server Action
// ---------------------------------------------------------------------------

export async function getTicketDashboard(
  companyId: string
): Promise<TicketDashboard> {
  await requireCompanyAccess(companyId);

  const cached = dashboardCache.get(companyId);
  if (cached && Date.now() - cached.timestamp < DASHBOARD_CACHE_TTL) {
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
      SELECT COALESCE(c."type", 'WEB') as channel, COUNT(*)::bigint as count
      FROM tickets t
      LEFT JOIN channels c ON t.channel_id = c.id
      WHERE t.company_id = ${companyId}
        AND t.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT')
      GROUP BY COALESCE(c."type", 'WEB')
    `,
    // Average response time (minutes from ticket creation to first message)
    prisma.$queryRaw<{ avg_minutes: number | null }[]>`
      SELECT AVG(response_minutes) as avg_minutes
      FROM (
        SELECT EXTRACT(EPOCH FROM (
          (SELECT MIN(tm.created_at) FROM ticket_messages tm WHERE tm.ticket_id = t.id) - t.created_at
        )) / 60 as response_minutes
        FROM tickets t
        WHERE t.company_id = ${companyId}
          AND EXISTS (SELECT 1 FROM ticket_messages tm WHERE tm.ticket_id = t.id)
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

  const result: TicketDashboard = {
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

  dashboardCache.set(companyId, { data: result, timestamp: Date.now() });

  return result;
}
