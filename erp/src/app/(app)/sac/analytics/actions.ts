"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DateRange {
  from: Date;
  to: Date;
}

export interface CostByDay {
  day: string;
  costBrl: number;
  calls: number;
}

export interface CostByChannel {
  channel: string;
  costBrl: number;
  calls: number;
}

export interface TopTicketCost {
  ticketId: string;
  costBrl: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SuggestionBreakdown {
  total: number;
  approved: number;
  rejected: number;
  edited: number;
  expired: number;
  approvalRate: number;
  rejectionRate: number;
}

export interface ConfidenceBucket {
  label: string;
  min: number;
  max: number;
  total: number;
  approved: number;
  rate: number;
}

export interface EscalationData {
  escalatedCount: number;
  totalAiTickets: number;
  rate: number;
}

export interface ToolUsage {
  tool: string;
  count: number;
}

export interface AiKpis {
  totalCostBrl: number;
  totalCalls: number;
  avgCostPerCall: number;
  totalTokens: number;
  aiResolvedTickets: number;
  humanResolvedTickets: number;
  aiResolutionRate: number;
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

export async function getAiKpis(
  companyId: string,
  period: DateRange,
): Promise<AiKpis> {
  const whereBase = {
    companyId,
    createdAt: { gte: period.from, lte: period.to },
    isSimulation: false,
  };

  const costAgg = await prisma.aiUsageLog.aggregate({
    where: whereBase,
    _sum: { costBrl: true, inputTokens: true, outputTokens: true },
    _count: true,
  });

  const totalCost = Number(costAgg._sum.costBrl ?? 0);
  const totalCalls = costAgg._count;
  const totalTokens =
    (costAgg._sum.inputTokens ?? 0) + (costAgg._sum.outputTokens ?? 0);

  // Tickets resolved in period with at least one AI-generated outbound message
  const aiResolvedTickets = await prisma.ticket.count({
    where: {
      companyId,
      status: { in: ["RESOLVED", "CLOSED"] },
      updatedAt: { gte: period.from, lte: period.to },
      messages: {
        some: {
          isAiGenerated: true,
          direction: "OUTBOUND",
        },
      },
    },
  });

  // Tickets resolved in period without any AI-generated message
  const humanResolvedTickets = await prisma.ticket.count({
    where: {
      companyId,
      status: { in: ["RESOLVED", "CLOSED"] },
      updatedAt: { gte: period.from, lte: period.to },
      messages: {
        none: {
          isAiGenerated: true,
          direction: "OUTBOUND",
        },
      },
    },
  });

  const totalResolved = aiResolvedTickets + humanResolvedTickets;

  return {
    totalCostBrl: totalCost,
    totalCalls,
    avgCostPerCall: totalCalls > 0 ? totalCost / totalCalls : 0,
    totalTokens,
    aiResolvedTickets,
    humanResolvedTickets,
    aiResolutionRate: totalResolved > 0 ? aiResolvedTickets / totalResolved : 0,
  };
}

// ─── Cost by Day ──────────────────────────────────────────────────────────────

export async function getCostByDay(
  companyId: string,
  period: DateRange,
): Promise<CostByDay[]> {
  const rows = await prisma.$queryRaw<
    { day: Date; cost_brl: Prisma.Decimal; calls: bigint }[]
  >`
    SELECT
      DATE("createdAt" AT TIME ZONE 'America/Sao_Paulo') as day,
      COALESCE(SUM("costBrl"), 0) as cost_brl,
      COUNT(*) as calls
    FROM "ai_usage_logs"
    WHERE "companyId" = ${companyId}
      AND "createdAt" >= ${period.from}
      AND "createdAt" <= ${period.to}
      AND "isSimulation" = false
    GROUP BY day
    ORDER BY day
  `;

  return rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    costBrl: Number(r.cost_brl),
    calls: Number(r.calls),
  }));
}

// ─── Cost by Channel ──────────────────────────────────────────────────────────

export async function getCostByChannel(
  companyId: string,
  period: DateRange,
): Promise<CostByChannel[]> {
  const results = await prisma.aiUsageLog.groupBy({
    by: ["channel"],
    where: {
      companyId,
      createdAt: { gte: period.from, lte: period.to },
      isSimulation: false,
    },
    _sum: { costBrl: true },
    _count: true,
  });

  return results.map((r) => ({
    channel: r.channel,
    costBrl: Number(r._sum.costBrl ?? 0),
    calls: r._count,
  }));
}

// ─── Top Tickets by Cost ──────────────────────────────────────────────────────

export async function getTopTicketsByCost(
  companyId: string,
  period: DateRange,
  limit = 10,
): Promise<TopTicketCost[]> {
  const results = await prisma.aiUsageLog.groupBy({
    by: ["ticketId"],
    where: {
      companyId,
      createdAt: { gte: period.from, lte: period.to },
      isSimulation: false,
      ticketId: { not: null },
    },
    _sum: { costBrl: true, inputTokens: true, outputTokens: true },
    orderBy: { _sum: { costBrl: "desc" } },
    take: limit,
  });

  return results.map((r) => ({
    ticketId: r.ticketId!,
    costBrl: Number(r._sum.costBrl ?? 0),
    inputTokens: r._sum.inputTokens ?? 0,
    outputTokens: r._sum.outputTokens ?? 0,
  }));
}

// ─── Confidence by Channel ────────────────────────────────────────────────────

export async function getConfidenceByChannel(
  companyId: string,
  period: DateRange,
): Promise<{ channel: string; avgConfidence: number; count: number }[]> {
  const results = await prisma.aiSuggestion.groupBy({
    by: ["channel"],
    where: {
      companyId,
      createdAt: { gte: period.from, lte: period.to },
    },
    _avg: { confidence: true },
    _count: true,
  });

  return results.map((r) => ({
    channel: r.channel,
    avgConfidence: r._avg.confidence ?? 0,
    count: r._count,
  }));
}

// ─── Suggestion Breakdown ─────────────────────────────────────────────────────

export async function getSuggestionBreakdown(
  companyId: string,
  period: DateRange,
): Promise<SuggestionBreakdown> {
  const results = await prisma.aiSuggestion.groupBy({
    by: ["status"],
    where: {
      companyId,
      createdAt: { gte: period.from, lte: period.to },
    },
    _count: true,
  });

  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.status] = r._count;
  }

  const total = Object.values(counts).reduce((s, c) => s + c, 0);
  const approved = counts["APPROVED"] ?? 0;
  const rejected = counts["REJECTED"] ?? 0;
  const edited = counts["EDITED"] ?? 0;
  const expired = counts["EXPIRED"] ?? 0;

  return {
    total,
    approved,
    rejected,
    edited,
    expired,
    approvalRate: total > 0 ? (approved + edited) / total : 0,
    rejectionRate: total > 0 ? rejected / total : 0,
  };
}

// ─── Confidence Calibration ────────────────────────────────────��──────────────

const CONFIDENCE_BUCKETS = [
  { min: 0.9, max: 1.01, label: "90-100%" },
  { min: 0.8, max: 0.9, label: "80-89%" },
  { min: 0.7, max: 0.8, label: "70-79%" },
  { min: 0.6, max: 0.7, label: "60-69%" },
  { min: 0.0, max: 0.6, label: "< 60%" },
];

export async function getConfidenceCalibration(
  companyId: string,
  period: DateRange,
): Promise<ConfidenceBucket[]> {
  const results: ConfidenceBucket[] = [];

  for (const bucket of CONFIDENCE_BUCKETS) {
    const whereBase = {
      companyId,
      createdAt: { gte: period.from, lte: period.to },
      confidence: { gte: bucket.min, lt: bucket.max },
      status: { notIn: ["PENDING" as const, "PROCESSING" as const] },
    };

    const [total, approved] = await Promise.all([
      prisma.aiSuggestion.count({ where: whereBase }),
      prisma.aiSuggestion.count({
        where: { ...whereBase, status: "APPROVED" },
      }),
    ]);

    results.push({
      label: bucket.label,
      min: bucket.min,
      max: bucket.max,
      total,
      approved,
      rate: total > 0 ? approved / total : 0,
    });
  }

  return results;
}

// ─── Escalation Rate ──────────────────────────────────────────────────────────

export async function getEscalationRate(
  companyId: string,
  period: DateRange,
): Promise<EscalationData> {
  const totalAiTickets = await prisma.ticket.count({
    where: {
      companyId,
      updatedAt: { gte: period.from, lte: period.to },
      messages: {
        some: { isAiGenerated: true },
      },
    },
  });

  const escalatedCount = await prisma.ticket.count({
    where: {
      companyId,
      updatedAt: { gte: period.from, lte: period.to },
      messages: {
        some: {
          isAiGenerated: true,
          OR: [
            { content: { contains: "[Escalado]" } },
            { content: { contains: "[SLA]" } },
          ],
        },
      },
    },
  });

  return {
    escalatedCount,
    totalAiTickets,
    rate: totalAiTickets > 0 ? escalatedCount / totalAiTickets : 0,
  };
}

// ─── Recent Escalations ──────────────────────────────────────���────────────────

export async function getRecentEscalations(
  companyId: string,
  limit = 10,
): Promise<
  {
    ticketId: string;
    subject: string;
    channel: string | null;
    escalatedAt: Date;
  }[]
> {
  const tickets = await prisma.ticket.findMany({
    where: {
      companyId,
      messages: {
        some: {
          isAiGenerated: true,
          OR: [
            { content: { contains: "[Escalado]" } },
            { content: { contains: "[SLA]" } },
          ],
        },
      },
    },
    select: {
      id: true,
      subject: true,
      channel: {
        select: { type: true },
      },
      messages: {
        where: {
          isAiGenerated: true,
          OR: [
            { content: { contains: "[Escalado]" } },
            { content: { contains: "[SLA]" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return tickets.map((t) => ({
    ticketId: t.id,
    subject: t.subject,
    channel: t.channel?.type ?? null,
    escalatedAt: t.messages[0]?.createdAt ?? new Date(),
  }));
}

// ─── Top Tools ────────────────────────────────────────────────────────────────

export async function getTopTools(
  companyId: string,
  period: DateRange,
  limit = 10,
): Promise<ToolUsage[]> {
  const suggestions = await prisma.aiSuggestion.findMany({
    where: {
      companyId,
      createdAt: { gte: period.from, lte: period.to },
    },
    select: { analysis: true },
  });

  const toolCounts = new Map<string, number>();
  for (const s of suggestions) {
    const analysis = s.analysis as Record<string, unknown> | null;
    const tools = (analysis?.toolsExecuted as string[]) ?? [];
    for (const tool of tools) {
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
    }
  }

  return Array.from(toolCounts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
