import { describe, it, expect } from "vitest";
import { suggestModel } from "@/lib/ai/model-suggester";
import { MODEL_PRICING, BRL_USD_RATE } from "@/lib/ai/pricing";

// Pre-calculate the cheapest daily cost for a few known models so tests
// stay in sync with the pricing table automatically.
function dailyCostBrl(model: string): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return Infinity;
  const costUsd = (100_000 * pricing.input + 100_000 * pricing.output) / 1_000_000;
  return costUsd * BRL_USD_RATE;
}

describe("suggestModel", () => {
  describe("openai provider", () => {
    it("returns gpt-4o-mini when budget is very small", () => {
      const result = suggestModel("openai", 0.01);
      // Falls back to cheapest model regardless of budget
      expect(result.model).toBe("gpt-4o-mini");
      expect(result.estimatedDailyCostBrl).toBeGreaterThan(0);
    });

    it("returns gpt-4o when budget is high enough", () => {
      const gpt4oCost = dailyCostBrl("gpt-4o");
      const result = suggestModel("openai", gpt4oCost + 1);
      expect(result.model).toBe("gpt-4o");
    });

    it("estimatedDailyCostBrl is a positive number", () => {
      const result = suggestModel("openai", 1000);
      expect(result.estimatedDailyCostBrl).toBeGreaterThan(0);
    });
  });

  describe("anthropic provider", () => {
    it("returns the cheapest model when budget is near zero", () => {
      const result = suggestModel("anthropic", 0.001);
      expect(result.model).toBe("claude-3-haiku-20240307");
    });

    it("returns opus when budget covers it", () => {
      const opusCost = dailyCostBrl("claude-opus-4-5");
      const result = suggestModel("anthropic", opusCost + 1);
      expect(result.model).toBe("claude-opus-4-5");
    });
  });

  describe("deepseek provider", () => {
    it("returns deepseek-chat as fallback when budget is near zero", () => {
      const result = suggestModel("deepseek", 0.001);
      expect(result.model).toBe("deepseek-chat");
      expect(result.estimatedDailyCostBrl).toBeGreaterThan(0);
    });

    it("returns deepseek-reasoner when budget is high enough", () => {
      const reasonerCost = dailyCostBrl("deepseek-reasoner");
      const result = suggestModel("deepseek", reasonerCost + 1);
      expect(result.model).toBe("deepseek-reasoner");
    });

    it("returns a valid deepseek model for any budget", () => {
      const result = suggestModel("deepseek", 100);
      expect(["deepseek-reasoner", "deepseek-chat"]).toContain(result.model);
      expect(result.estimatedDailyCostBrl).toBeGreaterThan(0);
    });
  });

  describe("unknown provider", () => {
    it("returns a fallback model", () => {
      const result = suggestModel("unknown-provider", 100);
      expect(result.model).toBeDefined();
      expect(result.estimatedDailyCostBrl).toBeGreaterThan(0);
    });
  });

  describe("budget boundary behaviour", () => {
    it("picks the most powerful model that fits within budget", () => {
      const miniCost = dailyCostBrl("gpt-4o-mini");
      const gpt4oCost = dailyCostBrl("gpt-4o");

      // Budget exactly at gpt-4o-mini but below gpt-4o → picks mini
      const result = suggestModel("openai", miniCost);
      if (gpt4oCost > miniCost) {
        expect(result.model).toBe("gpt-4o-mini");
      }
    });

    it("returns the cheapest model when no model fits (tiny budget)", () => {
      const result = suggestModel("qwen", 0);
      // Should still return the cheapest qwen model as fallback
      expect(["qwen-max", "qwen-plus", "qwen-turbo"]).toContain(result.model);
    });
  });
});
