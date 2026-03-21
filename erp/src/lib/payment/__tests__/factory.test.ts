import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import { getGateway } from "@/lib/payment/factory";
import { MockProvider } from "@/lib/payment/providers/mock.provider";
import { PagarmeProvider } from "@/lib/payment/providers/pagarme.provider";

describe("getGateway", () => {
  it("retorna MockProvider para type 'mock'", () => {
    const gw = getGateway("mock", {});
    expect(gw).toBeInstanceOf(MockProvider);
  });

  it("retorna PagarmeProvider para type 'pagarme' com credentials válidas", () => {
    const gw = getGateway("pagarme", { apiKey: "sk_test_123" });
    expect(gw).toBeInstanceOf(PagarmeProvider);
  });

  it("throw para type 'pagarme' sem apiKey", () => {
    expect(() => getGateway("pagarme", {})).toThrow("apiKey");
  });

  it("throw para type 'pagarme' com apiKey não-string", () => {
    expect(() => getGateway("pagarme", { apiKey: 123 })).toThrow("apiKey");
  });

  it("throw para type 'pinbank' (não implementado)", () => {
    expect(() => getGateway("pinbank", {})).toThrow("não está implementado");
  });

  it("throw para type desconhecido", () => {
    expect(() => getGateway("nonexistent", {})).toThrow("Provider not found");
  });

  it("passa metadata e webhookSecret para PagarmeProvider", () => {
    const gw = getGateway(
      "pagarme",
      { apiKey: "sk_test_123" },
      { defaultInstructions: "Custom instructions", daysToExpire: 10 },
      "webhook-secret-123",
    );
    expect(gw).toBeInstanceOf(PagarmeProvider);
  });

  it("aceita metadata null sem erro", () => {
    const gw = getGateway("pagarme", { apiKey: "sk_test_123" }, null);
    expect(gw).toBeInstanceOf(PagarmeProvider);
  });
});
