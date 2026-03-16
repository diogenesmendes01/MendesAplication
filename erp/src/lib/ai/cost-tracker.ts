"use server";

import { prisma } from "@/lib/prisma";
import {
  MODEL_PRICING,
  FALLBACK_PRICING,
  BRL_USD_RATE,
} from "@/lib/ai/pricing";

// ─── logUsage ─────────────────────────────────────────────────────────────────

interface LogUsageParams {
  aiConfigId: string;
  companyId: string;
  provider: string;
  model: string;
  channel: "WHATSAPP" | "EMAIL";
  inputTokens: number;
  outputTokens: number;
  ticketId?: string;
  /** When true the record is excluded from getTodaySpend() so admin simulations
   *  do not consume the company's real daily budget. */
  isSimulation?: boolean;
}

/**
 * Calculates cost and persists a usage record in AiUsageLog.
 */
export async function logUsage(params: LogUsageParams) {
  const pricing = MODEL_PRICING[params.model] ?? FALLBACK_PRICING;

  const costUsd =
    (params.inputTokens * pricing.input +
      params.outputTokens * pricing.output) /
    1_000_000;

  const costBrl = costUsd * BRL_USD_RATE;

  await prisma.aiUsageLog.create({
    data: {
      aiConfigId: params.aiConfigId,
      companyId: params.companyId,
      provider: params.provider,
      model: params.model,
      channel: params.channel,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: costUsd.toFixed(6),
      costBrl: costBrl.toFixed(4),
      ticketId: params.ticketId,
      isSimulation: params.isSimulation ?? false,
    },
  });
}

// ─── Timezone helper ─────────────────────────────────────────────────────────

/**
 * Returns the start of the current day in BRT (UTC-3).
 *
 * Cloud servers run in UTC by default. Without this adjustment, "today"
 * for companies in São Paulo would start at 21:00 UTC of the previous
 * calendar day — causing incorrect daily-spend calculations.
 *
 * Brazil does not currently observe DST (since 2019), so a fixed -3h
 * offset is accurate. If DST is ever reinstated, switch to a timezone
 * library (e.g. date-fns-tz) with "America/Sao_Paulo".
 */
function getStartOfDayBRT(): Date {
  const BRT_OFFSET_MS = 3 * 60 * 60 * 1_000; // UTC-3
  const nowMs = Date.now();
  // Shift to BRT, truncate to day boundary, then shift back to UTC
  const startOfDayMs =
    Math.floor((nowMs - BRT_OFFSET_MS) / 86_400_000) * 86_400_000 + BRT_OFFSET_MS;
  return new Date(startOfDayMs);
}

// ─── getTodaySpend ────────────────────────────────────────────────────────────

/**
 * Returns the total BRL spent by a company today (since midnight BRT / UTC-3).
 */
export async function getTodaySpend(companyId: string): Promise<number> {
  const startOfDay = getStartOfDayBRT();

  const result = await prisma.aiUsageLog.aggregate({
    where: {
      companyId,
      createdAt: { gte: startOfDay },
      // Exclude admin simulation records — they are logged for audit/UX but
      // must not block real agent responses due to reaching the daily limit.
      isSimulation: false,
    },
    _sum: { costBrl: true },
  });

  return Number(result._sum.costBrl ?? 0);
}

// ─── getUsageSummary ──────────────────────────────────────────────────────────

interface ChannelBreakdown {
  channel: string;
  totalTokens: number;
  costBrl: number;
}

interface ModelBreakdown {
  model: string;
  totalTokens: number;
  costBrl: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostBrl: number;
  totalCostUsd: number;
  byChannel: ChannelBreakdown[];
  byModel: ModelBreakdown[];
}

/**
 * Returns aggregated usage data for a company over the last N days.
 * Used by the frontend consumption tab.
 */
export async function getUsageSummary(
  companyId: string,
  days: number
): Promise<UsageSummary> {
  // Anchor the window to midnight BRT so day boundaries align with Brazil time
  const since = getStartOfDayBRT();
  since.setTime(since.getTime() - (days - 1) * 86_400_000);

  // Exclude simulation records so admin dry-runs don't inflate the
  // consumption totals displayed in the dashboard's Consumo tab.
  const where = { companyId, createdAt: { gte: since }, isSimulation: false };

  // Run all 3 aggregations in parallel — avoids sequential round-trips that
  // triple latency on admin queries spanning 30–90-day windows.
  const [totals, channelGroups, modelGroups] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        costBrl: true,
        costUsd: true,
      },
    }),
    prisma.aiUsageLog.groupBy({
      by: ["channel"],
      where,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        costBrl: true,
      },
    }),
    prisma.aiUsageLog.groupBy({
      by: ["model"],
      where,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        costBrl: true,
      },
    }),
  ]);

  return {
    totalInputTokens: totals._sum.inputTokens ?? 0,
    totalOutputTokens: totals._sum.outputTokens ?? 0,
    totalCostBrl: Number(totals._sum.costBrl ?? 0),
    totalCostUsd: Number(totals._sum.costUsd ?? 0),
    byChannel: channelGroups.map((g) => ({
      channel: g.channel,
      totalTokens: (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0),
      costBrl: Number(g._sum.costBrl ?? 0),
    })),
    byModel: modelGroups.map((g) => ({
      model: g.model,
      totalTokens: (g._sum.inputTokens ?? 0) + (g._sum.outputTokens ?? 0),
      costBrl: Number(g._sum.costBrl ?? 0),
    })),
  };
}
