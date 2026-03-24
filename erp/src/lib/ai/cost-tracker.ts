"use server";

import { prisma } from "@/lib/prisma";
import {
  MODEL_PRICING,
  FALLBACK_PRICING,
} from "@/lib/ai/pricing";
import { getBrlUsdRate } from "@/lib/ai/exchange-rate";
import { logger } from "@/lib/logger";
import Redis from "ioredis";

// ─── Redis singleton ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;
let redisAvailable = true;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.on("error", (err) => {
      logger.error({ err: err.message }, "[cost-tracker] Redis connection error");
      redisAvailable = false;
    });
    redis.on("connect", () => {
      redisAvailable = true;
    });
    redis.connect().catch((err) => {
      logger.error({ err: err.message }, "[cost-tracker] Redis initial connection failed");
      redisAvailable = false;
    });
  }
  return redis;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Multiplier to convert BRL floats to integer cents×100 for Redis INCRBY.
 *  e.g. R$0.05 → 500, R$1.2345 → 12345. Avoids floating-point drift. */
const BRL_TO_INT = 10_000;

// ─── Timezone helpers ─────────────────────────────────────────────────────────

const BRT_OFFSET_MS = 3 * 60 * 60 * 1_000; // UTC-3

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
  const nowMs = Date.now();
  // Shift to BRT, truncate to day boundary, then shift back to UTC
  const startOfDayMs =
    Math.floor((nowMs - BRT_OFFSET_MS) / 86_400_000) * 86_400_000 + BRT_OFFSET_MS;
  return new Date(startOfDayMs);
}

/**
 * Returns the current date string in BRT as YYYY-MM-DD.
 * Used to build the Redis key for daily spend tracking.
 */
function getTodayKeyBRT(): string {
  const now = new Date(Date.now() - BRT_OFFSET_MS);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns the number of seconds remaining until midnight BRT.
 * Used as Redis key EXPIRE TTL so counters auto-reset daily.
 */
function secondsUntilMidnightBRT(): number {
  const nowMs = Date.now();
  const startOfDayMs =
    Math.floor((nowMs - BRT_OFFSET_MS) / 86_400_000) * 86_400_000 + BRT_OFFSET_MS;
  const endOfDayMs = startOfDayMs + 86_400_000;
  return Math.max(1, Math.ceil((endOfDayMs - nowMs) / 1_000));
}

/**
 * Builds the Redis key for a company's daily AI spend counter.
 */
function spendKey(companyId: string): string {
  return `ai:daily_spend:${companyId}:${getTodayKeyBRT()}`;
}

// ─── checkAndReserveSpend ─────────────────────────────────────────────────────

/**
 * Atomically checks whether adding `estimatedCostBrl` would exceed the
 * company's `dailyLimitBrl`. If within budget, the amount is reserved
 * (INCRBY). If over budget, the increment is rolled back (DECRBY).
 *
 * Uses Redis for atomicity. Falls back to DB-based getTodaySpend() when
 * Redis is unavailable (non-atomic but functional).
 *
 * Values are stored as integers ×10000 to avoid floating-point issues
 * in Redis INCRBY.
 *
 * @returns true if the spend was reserved (within limit), false if denied.
 */
export async function checkAndReserveSpend(
  companyId: string,
  dailyLimitBrl: number,
  estimatedCostBrl: number
): Promise<boolean> {
  const key = spendKey(companyId);
  const incrementInt = Math.round(estimatedCostBrl * BRL_TO_INT);
  const limitInt = Math.round(dailyLimitBrl * BRL_TO_INT);

  // ── Redis path (atomic) ────────────────────────────────────────────────
  if (redisAvailable) {
    try {
      const client = getRedis();
      const newTotal = await client.incrby(key, incrementInt);

      // Set EXPIRE on first write (when newTotal equals the increment we just added)
      if (newTotal === incrementInt) {
        await client.expire(key, secondsUntilMidnightBRT());
      }

      if (newTotal > limitInt) {
        // Over limit — rollback the increment we just added
        await client.decrby(key, incrementInt);
        return false;
      }

      return true;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), companyId },
        "[cost-tracker] Redis checkAndReserveSpend failed, falling back to DB"
      );
      // Fall through to DB fallback
    }
  }

  // ── DB fallback (non-atomic, best-effort) ──────────────────────────────
  const currentSpend = await getTodaySpend(companyId);
  return currentSpend + estimatedCostBrl <= dailyLimitBrl;
}

// ─── rollbackSpendReservation ─────────────────────────────────────────────────

/**
 * Rolls back a previously reserved spend amount from the Redis counter.
 * Used when:
 * - An escalation keyword is detected after reservation (no LLM call needed)
 * - Reconciling estimated vs actual cost after logUsage records the real amount
 *
 * No-op when Redis is unavailable (the DB-based fallback in
 * checkAndReserveSpend doesn't pre-reserve, so there's nothing to undo).
 */
export async function rollbackSpendReservation(
  companyId: string,
  amountBrl: number
): Promise<void> {
  if (!redisAvailable) return;

  const key = spendKey(companyId);
  const decrementInt = Math.round(amountBrl * BRL_TO_INT);

  try {
    const client = getRedis();
    const newVal = await client.decrby(key, decrementInt);

    // Safety: don't let the counter go negative (shouldn't happen, but guard)
    if (newVal < 0) {
      await client.set(key, "0", "EX", secondsUntilMidnightBRT());
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), companyId },
      "[cost-tracker] Redis rollbackSpendReservation failed (non-critical)"
    );
  }
}

// ─── atomicSpendIncrement ─────────────────────────────────────────────────────

/**
 * Adds the actual cost to the Redis daily counter after logUsage persists
 * the real cost to the database. This keeps the Redis counter in sync
 * with reality so subsequent checkAndReserveSpend calls use accurate data.
 *
 * Called internally by logUsage after the DB write succeeds.
 */
async function atomicSpendIncrement(
  companyId: string,
  costBrl: number
): Promise<void> {
  if (!redisAvailable) return;

  const key = spendKey(companyId);
  const incrementInt = Math.round(costBrl * BRL_TO_INT);

  try {
    const client = getRedis();
    await client.incrby(key, incrementInt);
    // Ensure TTL is set (in case key was created fresh by this call)
    const ttl = await client.ttl(key);
    if (ttl === -1) {
      await client.expire(key, secondsUntilMidnightBRT());
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), companyId },
      "[cost-tracker] Redis atomicSpendIncrement failed (non-critical)"
    );
  }
}

// ─── logUsage ─────────────────────────────────────────────────────────────────

interface LogUsageParams {
  aiConfigId: string;
  companyId: string;
  provider: string;
  model: string;
  channel: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI";
  inputTokens: number;
  outputTokens: number;
  ticketId?: string;
  /** When true the record is excluded from getTodaySpend() so admin simulations
   *  do not consume the company's real daily budget. */
  isSimulation?: boolean;
}

/**
 * Calculates cost and persists a usage record in AiUsageLog.
 * Uses dynamic BRL/USD exchange rate from AwesomeAPI (24h cache).
 *
 * Also updates the Redis daily spend counter via atomicSpendIncrement
 * so subsequent checkAndReserveSpend calls use up-to-date data.
 *
 * @returns The created usage log record, or null on failure.
 */
export async function logUsage(params: LogUsageParams) {
  const pricing = MODEL_PRICING[params.model] ?? FALLBACK_PRICING;

  if (!MODEL_PRICING[params.model]) {
    logger.warn(
      `[cost-tracker] Unknown model "${params.model}" — using FALLBACK_PRICING. ` +
      `Update MODEL_PRICING in pricing.ts to track costs accurately.`
    );
  }

  const costUsd =
    (params.inputTokens * pricing.input +
      params.outputTokens * pricing.output) /
    1_000_000;

  const brlUsdRate = await getBrlUsdRate();
  const costBrl = costUsd * brlUsdRate;

  const record = await prisma.aiUsageLog.create({
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

  // Keep Redis counter in sync with the actual persisted cost.
  // Only for non-simulation records (simulations don't count against the limit).
  if (!params.isSimulation) {
    await atomicSpendIncrement(params.companyId, costBrl);
  }

  return record;
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
