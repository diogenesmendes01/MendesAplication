import { describe, it, expect, beforeEach } from "vitest";
import {
  discoverModels,
  getModelsSync,
  clearModelCache,
  STATIC_MODELS,
} from "@/lib/ai/model-discovery";

beforeEach(() => {
  clearModelCache();
});

describe("STATIC_MODELS", () => {
  it("has entries for all known providers", () => {
    expect(STATIC_MODELS.openai).toBeDefined();
    expect(STATIC_MODELS.anthropic).toBeDefined();
    expect(STATIC_MODELS.grok).toBeDefined();
    expect(STATIC_MODELS.qwen).toBeDefined();
    expect(STATIC_MODELS.deepseek).toBeDefined();
  });

  it("each provider has at least one model", () => {
    for (const [provider, models] of Object.entries(STATIC_MODELS)) {
      expect(models.length, `${provider} should have models`).toBeGreaterThan(0);
    }
  });
});

describe("getModelsSync", () => {
  it("returns static models when cache is empty", () => {
    const models = getModelsSync("openai");
    expect(models).toEqual(STATIC_MODELS.openai);
  });

  it("returns empty array for unknown provider", () => {
    const models = getModelsSync("unknown-provider");
    expect(models).toEqual([]);
  });
});

describe("discoverModels", () => {
  it("returns static models when no API key provided", async () => {
    const models = await discoverModels("anthropic");
    expect(models).toEqual(STATIC_MODELS.anthropic);
  });

  it("returns static models for providers without list endpoint", async () => {
    // anthropic and qwen have no list endpoint → always returns static
    const models = await discoverModels("qwen", { apiKey: "fake-key" });
    expect(models).toEqual(STATIC_MODELS.qwen);
  });

  it("returns empty array for unknown provider", async () => {
    const models = await discoverModels("unknown");
    expect(models).toEqual([]);
  });

  it("falls back to static when API key is missing for openai", async () => {
    const models = await discoverModels("openai");
    expect(models).toEqual(STATIC_MODELS.openai);
  });
});
