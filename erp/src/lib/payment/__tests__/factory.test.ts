import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  return {
    logger: _log,
    createChildLogger: vi.fn(() => _log),
    sanitizeParams: vi.fn((obj: Record<string, unknown>) => obj),
    truncateForLog: vi.fn((v: unknown) => v),
    classifyError: vi.fn(() => "INTERNAL_ERROR"),
    classifyErrorByStatus: vi.fn(() => "INTERNAL_ERROR"),
    ErrorCode: {
      AUTH_FAILED: "AUTH_FAILED",
      VALIDATION_ERROR: "VALIDATION_ERROR",
      NOT_FOUND: "NOT_FOUND",
      PERMISSION_DENIED: "PERMISSION_DENIED",
      EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
      DATABASE_ERROR: "DATABASE_ERROR",
      ENCRYPTION_ERROR: "ENCRYPTION_ERROR",
      RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
      INTERNAL_ERROR: "INTERNAL_ERROR",
      AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
    },
    MAX_LOG_ARG_SIZE: 10240,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import { getGateway } from "@/lib/payment/factory";
import { MockProvider } from "@/lib/payment/providers/mock.provider";
import { PagarmeProvider } from "@/lib/payment/providers/pagarme.provider";

describe("getGateway", () => {
  it("retorna MockProvider para type 'mock'", async () => {
    const gw = await getGateway("mock", {});
    expect(gw).toBeInstanceOf(MockProvider);
  });

  it("retorna PagarmeProvider para type 'pagarme' com credentials válidas", async () => {
    const gw = await getGateway("pagarme", { apiKey: "sk_test_123" });
    expect(gw).toBeInstanceOf(PagarmeProvider);
  });

  it("throw para type 'pagarme' sem apiKey", async () => {
    await expect(getGateway("pagarme", {})).rejects.toThrow("apiKey");
  });

  it("throw para type 'pagarme' com apiKey não-string", async () => {
    await expect(getGateway("pagarme", { apiKey: 123 })).rejects.toThrow("apiKey");
  });

  it("throw para type 'pinbank' (não implementado)", async () => {
    await expect(getGateway("pinbank", {})).rejects.toThrow("não está implementado");
  });

  it("throw para type desconhecido", async () => {
    await expect(getGateway("nonexistent", {})).rejects.toThrow("Provider not found");
  });

  it("passa metadata e webhookSecret para PagarmeProvider", async () => {
    const gw = await getGateway(
      "pagarme",
      { apiKey: "sk_test_123" },
      { defaultInstructions: "Custom instructions", daysToExpire: 10 },
      "webhook-secret-123",
    );
    expect(gw).toBeInstanceOf(PagarmeProvider);
  });

  it("aceita metadata null sem erro", async () => {
    const gw = await getGateway("pagarme", { apiKey: "sk_test_123" }, null);
    expect(gw).toBeInstanceOf(PagarmeProvider);
  });
});
