import { MODEL_PRICING, BRL_USD_RATE } from "@/lib/ai/pricing";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelSuggestion {
  model: string;
  estimatedDailyCostBrl: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Estimated daily token usage for cost projection.
 * Assumes ~100 conversations/day, ~1000 input + 1000 output tokens each.
 */
const ESTIMATED_DAILY_INPUT_TOKENS = 100_000;
const ESTIMATED_DAILY_OUTPUT_TOKENS = 100_000;

/**
 * Models available per provider, ordered from most powerful to least powerful.
 * suggestModel() picks the first (most capable) model that fits the budget.
 */
const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-20250414",
  ],
  grok: ["grok-2", "grok-2-mini"],
  qwen: ["qwen-max", "qwen-plus", "qwen-turbo"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateDailyCostBrl(model: string): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return Infinity;

  const costUsd =
    (ESTIMATED_DAILY_INPUT_TOKENS * pricing.input +
      ESTIMATED_DAILY_OUTPUT_TOKENS * pricing.output) /
    1_000_000;

  return costUsd * BRL_USD_RATE;
}

// ─── suggestModel ─────────────────────────────────────────────────────────────

/**
 * Returns the most powerful model for a given provider that fits
 * within the daily budget (BRL).
 *
 * Pure function — no I/O, no DB access, no "use server" needed.
 */
export function suggestModel(
  provider: string,
  dailyBudgetBrl: number
): ModelSuggestion {
  const models = PROVIDER_MODELS[provider];

  if (!models || models.length === 0) {
    return { model: "gpt-4o-mini", estimatedDailyCostBrl: estimateDailyCostBrl("gpt-4o-mini") };
  }

  for (const model of models) {
    const cost = estimateDailyCostBrl(model);
    if (cost <= dailyBudgetBrl) {
      return { model, estimatedDailyCostBrl: cost };
    }
  }

  // Fallback: cheapest model for the provider
  const cheapest = models[models.length - 1];
  return {
    model: cheapest,
    estimatedDailyCostBrl: estimateDailyCostBrl(cheapest),
  };
}
