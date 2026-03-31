"use server";

import { requireCompanyAccess } from "@/lib/rbac";
import { getCompanyKpis } from "@/lib/kpi-cache";
import { prisma } from "@/lib/prisma";
import type { ChannelType } from "@prisma/client";
import { RA_STATUS_ID } from "./ra-actions.types";

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
  urgentTickets: {
    id: string;
    subject: string;
    priority: string;
    status: string;
    updatedAt: Date;
  }[];
}

export interface ChannelDashboardData {
  // Email
  inboxPendente?: number;
  respondidosHoje?: number;
  backlog24h?: number;
  avgResponseTimeMinutes?: number;
  // WhatsApp
  conversasAtivas?: number;
  aguardandoCliente?: number;
  iaAutoRespondeu?: number;
  precisaHumano?: number;
  // ReclameAqui
  notaGeral?: number;
  respondidas?: number;
  total?: number;
  taxaResolucao?: number;
  aguardandoModeracao?: number;
  raSlaAtRisk?: number;
  raSlaBreached?: number;
}

// ---------------------------------------------------------------------------
// Master Dashboard — all channels (uses kpi-cache)
// Channel-filtered variant — direct queries, bypasses cache
// ---------------------------------------------------------------------------

export async function getTicketDashboard(
  companyId: string,
  channelType?: ChannelType
): Promise<TicketDashboard> {
  await requireCompanyAccess(companyId);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const activeStatuses = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] as const;

  if (channelType) {
    // -----------------------------------------------------------------------
    // Channel-filtered: run direct prisma queries (no kpi-cache)
    // -----------------------------------------------------------------------
    const channelWhere = { companyId, channel: { type: channelType } } as const;

    const [
      openCount,
      inProgressCount,
      waitingClientCount,
      resolvedTodayCount,
      slaBreachedCount,
      pendingRefundsCount,
      urgentTickets,
      priorityGroups,
      slaAtRiskCount,
      ticketsForAvg,
    ] = await Promise.all([
      prisma.ticket.count({ where: { ...channelWhere, status: "OPEN" } }),
      prisma.ticket.count({ where: { ...channelWhere, status: "IN_PROGRESS" } }),
      prisma.ticket.count({ where: { ...channelWhere, status: "WAITING_CLIENT" } }),
      prisma.ticket.count({
        where: {
          ...channelWhere,
          status: "RESOLVED",
          updatedAt: { gte: startOfToday },
        },
      }),
      prisma.ticket.count({
        where: {
          ...channelWhere,
          slaBreached: true,
          status: { in: [...activeStatuses] },
        },
      }),
      prisma.refund.count({
        where: { companyId, status: "AWAITING_APPROVAL" },
      }),
      prisma.ticket.findMany({
        where: {
          ...channelWhere,
          slaBreached: true,
          status: { in: [...activeStatuses] },
        },
        orderBy: { updatedAt: "asc" },
        take: 5,
        select: {
          id: true,
          subject: true,
          priority: true,
          status: true,
          updatedAt: true,
        },
      }),
      prisma.ticket.groupBy({
        by: ["priority"],
        where: { ...channelWhere, status: { in: [...activeStatuses] } },
        _count: true,
      }),
      // SLA at risk
      prisma.ticket.count({
        where: {
          ...channelWhere,
          slaAtRisk: true,
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      }),
      // Avg response time
      prisma.ticket.findMany({
        where: { ...channelWhere, messages: { some: {} } },
        select: {
          createdAt: true,
          messages: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { createdAt: true },
          },
        },
        take: 500,
      }),
    ]);

    const responseTimes = ticketsForAvg
      .filter((t) => t.messages.length > 0)
      .map(
        (t) =>
          (t.messages[0].createdAt.getTime() - t.createdAt.getTime()) / 60_000
      )
      .filter((m) => m >= 0);
    const avgResponseTimeMinutes =
      responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0;

    return {
      openCount,
      inProgressCount,
      waitingClientCount,
      resolvedTodayCount,
      slaBreachedCount,
      slaAtRiskCount,
      pendingRefundsCount,
      avgResponseTimeMinutes,
      ticketsByChannel: [{ channel: channelType, count: openCount + inProgressCount + waitingClientCount }],
      ticketsByPriority: priorityGroups.map((g) => ({
        priority: g.priority,
        count: g._count,
      })),
      urgentTickets,
    };
  }

  // -------------------------------------------------------------------------
  // All-channels: use kpi-cache for performance
  // -------------------------------------------------------------------------
  const kpis = await getCompanyKpis(companyId);

  const urgentTickets = await prisma.ticket.findMany({
    where: {
      companyId,
      slaBreached: true,
      status: { in: [...activeStatuses] },
    },
    orderBy: { updatedAt: "asc" },
    take: 5,
    select: {
      id: true,
      subject: true,
      priority: true,
      status: true,
      updatedAt: true,
    },
  });

  return {
    openCount: kpis.openCount,
    inProgressCount: kpis.inProgressCount,
    waitingClientCount: kpis.waitingClientCount,
    resolvedTodayCount: kpis.resolvedTodayCount,
    slaBreachedCount: kpis.slaBreachedCount,
    slaAtRiskCount: kpis.slaAtRiskCount,
    pendingRefundsCount: kpis.pendingRefundsCount,
    avgResponseTimeMinutes: kpis.avgResponseTimeMinutes,
    ticketsByChannel: kpis.ticketsByChannel,
    ticketsByPriority: kpis.ticketsByPriority,
    urgentTickets,
  };
}

// ---------------------------------------------------------------------------
// Channel Dashboard — channel-specific KPIs
// ---------------------------------------------------------------------------

export async function getChannelDashboard(
  companyId: string,
  channelType: ChannelType
): Promise<ChannelDashboardData> {
  await requireCompanyAccess(companyId);

  const channelWhere = {
    companyId,
    channel: { type: channelType },
  } as const;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // -------------------------------------------------------------------------
  // EMAIL
  // -------------------------------------------------------------------------
  if (channelType === "EMAIL") {
    const [inboxPendente, respondidosHoje, backlog24h, ticketsForAvg] =
      await Promise.all([
        prisma.ticket.count({
          where: { ...channelWhere, status: "OPEN" },
        }),
        prisma.ticket.count({
          where: {
            ...channelWhere,
            status: "RESOLVED",
            updatedAt: { gte: startOfToday },
          },
        }),
        prisma.ticket.count({
          where: {
            ...channelWhere,
            status: "OPEN",
            createdAt: { lt: yesterday },
          },
        }),
        prisma.ticket.findMany({
          where: {
            ...channelWhere,
            messages: { some: {} },
          },
          select: {
            createdAt: true,
            messages: {
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { createdAt: true },
            },
          },
          take: 500,
        }),
      ]);

    const responseTimes = ticketsForAvg
      .filter((t) => t.messages.length > 0)
      .map(
        (t) =>
          (t.messages[0].createdAt.getTime() - t.createdAt.getTime()) / 60_000
      )
      .filter((m) => m >= 0);

    const avgResponseTimeMinutes =
      responseTimes.length > 0
        ? Math.round(
            responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          )
        : 0;

    return { inboxPendente, respondidosHoje, backlog24h, avgResponseTimeMinutes };
  }

  // -------------------------------------------------------------------------
  // WHATSAPP
  // -------------------------------------------------------------------------
  if (channelType === "WHATSAPP") {
    const [conversasAtivas, aguardandoCliente, iaAutoRespondeu, precisaHumano] =
      await Promise.all([
        prisma.ticket.count({
          where: { ...channelWhere, status: "IN_PROGRESS" },
        }),
        prisma.ticket.count({
          where: { ...channelWhere, status: "WAITING_CLIENT" },
        }),
        // AI auto-responded: resolved today with aiEnabled=true
        prisma.ticket.count({
          where: {
            ...channelWhere,
            aiEnabled: true,
            status: "RESOLVED",
            updatedAt: { gte: startOfToday },
          },
        }),
        // Needs human: active tickets with a human assignee
        prisma.ticket.count({
          where: {
            ...channelWhere,
            status: { in: ["IN_PROGRESS", "WAITING_CLIENT"] },
            assigneeId: { not: null },
          },
        }),
      ]);

    return { conversasAtivas, aguardandoCliente, iaAutoRespondeu, precisaHumano };
  }

  // -------------------------------------------------------------------------
  // RECLAMEAQUI
  // -------------------------------------------------------------------------
  if (channelType === "RECLAMEAQUI") {
    const [ticketsMeta, respondidas, resolvidas, aguardandoModeracao, raSlaAtRisk, raSlaBreached] =
      await Promise.all([
        prisma.ticket.findMany({
          where: { ...channelWhere },
          select: { raRating: true },
        }),
        prisma.ticket.count({
          where: {
            ...channelWhere,
            raStatusName: { contains: "Respondid" },
          },
        }),
        prisma.ticket.count({
          where: { ...channelWhere, raResolvedIssue: true },
        }),
        prisma.ticket.count({
          where: { ...channelWhere, raStatusId: RA_STATUS_ID.PENDING_MODERATION },
        }),
        prisma.ticket.count({
          where: { ...channelWhere, raSlaDeadline: { not: null }, slaAtRisk: true, slaBreached: false, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } },
        }),
        prisma.ticket.count({
          where: { ...channelWhere, raSlaDeadline: { not: null }, slaBreached: true, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } },
        }),
      ]);

    const total = ticketsMeta.length;
    const ratings = ticketsMeta
      .map((t) => parseFloat(t.raRating ?? ""))
      .filter((n) => !isNaN(n));
    const notaGeral =
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;
    const taxaResolucao = total > 0 ? (resolvidas / total) * 100 : 0;

    return { notaGeral, respondidas, total, taxaResolucao, aguardandoModeracao, raSlaAtRisk, raSlaBreached };
  }

  return {};
}
