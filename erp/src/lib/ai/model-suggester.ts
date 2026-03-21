import { MODEL_PRICING } from "@/lib/ai/pricing";
import { getBrlUsdRateSync } from "@/lib/ai/exchange-rate";
import { getModelsSync, STATIC_MODELS } from "@/lib/ai/model-discovery";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateDailyCostBrl(model: string): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return Infinity;

  const costUsd =
    (ESTIMATED_DAILY_INPUT_TOKENS * pricing.input +
      ESTIMATED_DAILY_OUTPUT_TOKENS * pricing.output) /
    1_000_000;

  return costUsd * getBrlUsdRateSync();
}

// ─── suggestModel ─────────────────────────────────────────────────────────────

/**
 * Returns the most powerful model for a given provider that fits
 * within the daily budget (BRL).
 *
 * Uses dynamically discovered models (from cache) when available,
 * falling back to the static list. For cost-based ranking, only models
 * present in MODEL_PRICING are considered.
 *
 * Pure function — no I/O, no DB access, no "use server" needed.
 */
export function suggestModel(
  provider: string,
  dailyBudgetBrl: number
): ModelSuggestion {
  // getModelsSync returns cached dynamic models or static fallback
  const discoveredModels = getModelsSync(provider);

  // For suggestion purposes, we need models with known pricing.
  // Use the static list order (most powerful → least powerful) as the
  // ranked subset, since dynamically discovered models may include
  // models without pricing info.
  const rankedModels = STATIC_MODELS[provider] ?? [];

  // Merge: use ranked static list but also include any discovered models
  // that have pricing info (preserving static order first)
  const models = [
    ...rankedModels,
    ...discoveredModels.filter(
      (m) => !rankedModels.includes(m) && MODEL_PRICING[m],
    ),
  ];

  if (models.length === 0) {
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
