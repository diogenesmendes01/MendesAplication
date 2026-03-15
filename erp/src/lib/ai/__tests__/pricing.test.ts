import { describe, it, expect } from "vitest";
import {
  MODEL_PRICING,
  FALLBACK_PRICING,
  BRL_USD_RATE,
  DEFAULT_MODELS,
} from "@/lib/ai/pricing";

describe("pricing constants", () => {
  it("BRL_USD_RATE is a positive number", () => {
    expect(BRL_USD_RATE).toBeGreaterThan(0);
    expect(typeof BRL_USD_RATE).toBe("number");
  });

  it("MODEL_PRICING entries all have positive input and output rates", () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.input, `${model}.input`).toBeGreaterThan(0);
      expect(pricing.output, `${model}.output`).toBeGreaterThan(0);
    }
  });

  it("FALLBACK_PRICING has positive rates", () => {
    expect(FALLBACK_PRICING.input).toBeGreaterThan(0);
    expect(FALLBACK_PRICING.output).toBeGreaterThan(0);
  });

  it("DEFAULT_MODELS covers all supported providers", () => {
    const expectedProviders = ["openai", "anthropic", "grok", "qwen", "deepseek"];
    for (const provider of expectedProviders) {
      expect(DEFAULT_MODELS[provider], `DEFAULT_MODELS[${provider}]`).toBeDefined();
    }
  });

  it("all DEFAULT_MODELS values reference existing MODEL_PRICING entries", () => {
    for (const [provider, model] of Object.entries(DEFAULT_MODELS)) {
      expect(
        MODEL_PRICING[model],
        `Default model "${model}" for provider "${provider}" must be in MODEL_PRICING`
      ).toBeDefined();
    }
  });

  it("output price is greater than or equal to input price for each model", () => {
    // Output tokens are typically priced higher than input tokens
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(
        pricing.output,
        `${model}: output price should be >= input price`
      ).toBeGreaterThanOrEqual(pricing.input);
    }
  });
});
