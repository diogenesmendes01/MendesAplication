// ─── Pricing table (USD per 1M tokens) ───────────────────────────────────────
// Update prices when providers change their rates.
// Source: each provider's pricing page.
// Last verified: 2026-03-16
// Review schedule: quarterly (next: 2026-06-16)
// This file has NO "use server" directive — constants are importable anywhere.

import { getBrlUsdRate, getBrlUsdRateSync } from "@/lib/ai/exchange-rate";

export interface ModelPricing {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },

  // Anthropic
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5":          { input: 0.8, output: 4.0 },
  "claude-haiku-4-20250414":   { input: 0.8, output: 4.0 }, // alias kept for compat
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
  "claude-3-haiku-20240307":   { input: 0.25, output: 1.25 },
  "claude-opus-4-5":           { input: 15.0, output: 75.0 },
  "claude-sonnet-4-5":         { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },

  // Grok (xAI)
  "grok-2": { input: 2.0, output: 10.0 },
  "grok-2-mini": { input: 0.3, output: 0.5 },

  // Qwen (Alibaba)
  "qwen-max": { input: 1.6, output: 6.4 },
  "qwen-plus": { input: 0.5, output: 1.5 },
  "qwen-turbo": { input: 0.15, output: 0.3 },

  // DeepSeek — source: https://api-docs.deepseek.com/quick_start/pricing (verified 2025-01)
  "deepseek-chat":     { input: 0.27, output: 1.10 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

// Fallback pricing for unknown models.
// ⚠️ WARNING: When a model is not in MODEL_PRICING, cost-tracker.ts will
// log a warning and use this generic fallback. Add new models to
// MODEL_PRICING to track costs accurately.
// See: https://github.com/diogenesmendes01/MendesAplication/issues/128
export const FALLBACK_PRICING: ModelPricing = { input: 1.0, output: 3.0 };

/**
 * BRL/USD exchange rate — dynamic via AwesomeAPI (24h cache).
 *
 * Re-exported from exchange-rate.ts for backward compatibility.
 * Sync consumers get the cached rate; async consumers should use getBrlUsdRate().
 *
 * Fixes: https://github.com/diogenesmendes01/MendesAplication/issues/280
 */
export { getBrlUsdRate, getBrlUsdRateSync };

/**
 * Synchronous BRL/USD rate accessor for backward compatibility.
 * Returns the cached dynamic rate (or env fallback on first call).
 *
 * @deprecated Use getBrlUsdRate() (async) or getBrlUsdRateSync() instead.
 */
export const BRL_USD_RATE: number = getBrlUsdRateSync();

/**
 * Default model names per provider — used as fallback for usage logging
 * when no specific model is configured.
 */
export const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
  anthropic: "claude-sonnet-4-20250514",
  grok: "grok-2",
  qwen: "qwen-max",
};
