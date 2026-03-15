// ─── Pricing table (USD per 1M tokens) ───────────────────────────────────────
// Update prices when providers change their rates.
// Source: each provider's pricing page.
// This file has NO "use server" directive — constants are importable anywhere.

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
  "claude-haiku-4-20250414": { input: 0.8, output: 4.0 },

  // Grok (xAI)
  "grok-2": { input: 2.0, output: 10.0 },
  "grok-2-mini": { input: 0.3, output: 0.5 },

  // Qwen (Alibaba)
  "qwen-max": { input: 1.6, output: 6.4 },
  "qwen-plus": { input: 0.5, output: 1.5 },
  "qwen-turbo": { input: 0.15, output: 0.3 },
};

// Fallback pricing for unknown models
export const FALLBACK_PRICING: ModelPricing = { input: 1.0, output: 3.0 };

/**
 * BRL/USD exchange rate — hardcoded for now.
 * TODO: Replace with a real-time exchange rate API in the future
 * (e.g., BrasilAPI, AwesomeAPI — update at least 1x/day).
 */
export const BRL_USD_RATE = 5.8;

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
