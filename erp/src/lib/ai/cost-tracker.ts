"use server";

import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import {
  MODEL_PRICING,
  FALLBACK_PRICING,
  BRL_USD_RATE,
} from "@/lib/ai/pricing";

// Re-export for backward compat (callers that imported from cost-tracker)
export { MODEL_PRICING, BRL_USD_RATE } from "@/lib/ai/pricing";

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
      costUsd: new Decimal(costUsd.toFixed(6)),
      costBrl: new Decimal(costBrl.toFixed(4)),
      ticketId: params.ticketId,
    },
  });
}

// ─── getTodaySpend ────────────────────────────────────────────────────────────

/**
 * Returns the total BRL spent by a company today (since midnight local time).
 */
export async function getTodaySpend(companyId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const result = await prisma.aiUsageLog.aggregate({
    where: {
      companyId,
      createdAt: { gte: startOfDay },
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
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const where = { companyId, createdAt: { gte: since } };

  // Overall totals
  const totals = await prisma.aiUsageLog.aggregate({
    where,
    _sum: {
      inputTokens: true,
      outputTokens: true,
      costBrl: true,
      costUsd: true,
    },
  });

  // Breakdown by channel
  const channelGroups = await prisma.aiUsageLog.groupBy({
    by: ["channel"],
    where,
    _sum: {
      inputTokens: true,
      outputTokens: true,
      costBrl: true,
    },
  });

  // Breakdown by model
  const modelGroups = await prisma.aiUsageLog.groupBy({
    by: ["model"],
    where,
    _sum: {
      inputTokens: true,
      outputTokens: true,
      costBrl: true,
    },
  });

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
