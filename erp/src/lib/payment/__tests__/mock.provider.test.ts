import { describe, it, expect, vi } from "vitest";
import { MockProvider } from "@/lib/payment/providers/mock.provider";
import { makeCreateBoletoInput } from "./helpers";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("MockProvider", () => {
  const provider = new MockProvider();

  describe("createBoleto", () => {
    it("retorna estrutura válida com todos os campos", async () => {
      const input = makeCreateBoletoInput();
      const result = await provider.createBoleto(input);

      expect(result.gatewayId).toBeDefined();
      expect(result.gatewayId).toMatch(/^MOCK/);
      expect(result.url).toContain("mock-bank.example.com");
      expect(result.line).toBeDefined();
      expect(result.barcode).toBeDefined();
      expect(result.qrCode).toBeDefined();
      expect(result.pdf).toBeDefined();
      expect(result.nossoNumero).toBeDefined();
      expect(result.rawResponse).toBeDefined();
    });

    it("inclui provider: 'mock' no rawResponse", async () => {
      const result = await provider.createBoleto(makeCreateBoletoInput());
      expect((result.rawResponse as Record<string, unknown>).provider).toBe("mock");
    });

    it("gera gatewayIds únicos", async () => {
      const input = makeCreateBoletoInput();
      const r1 = await provider.createBoleto(input);
      const r2 = await provider.createBoleto(input);
      expect(r1.gatewayId).not.toBe(r2.gatewayId);
    });

    it("incorpora installmentNumber no gatewayId", async () => {
      const result = await provider.createBoleto(makeCreateBoletoInput({ installmentNumber: 5 }));
      expect(result.gatewayId).toContain("5");
    });
  });

  describe("getBoletoStatus", () => {
    it("retorna status pending", async () => {
      const result = await provider.getBoletoStatus("MOCK123");
      expect(result.gatewayId).toBe("MOCK123");
      expect(result.status).toBe("pending");
    });
  });

  describe("cancelBoleto", () => {
    it("retorna success: true", async () => {
      expect((await provider.cancelBoleto()).success).toBe(true);
    });
  });

  describe("validateWebhook", () => {
    it("sempre retorna true (mock)", () => {
      expect(provider.validateWebhook()).toBe(true);
    });
  });

  describe("parseWebhookEvent", () => {
    it("retorna event válido com type boleto.paid", () => {
      const event = provider.parseWebhookEvent(JSON.stringify({ gatewayId: "MOCK123", amount: 10000 }));
      expect(event).not.toBeNull();
      expect(event!.type).toBe("boleto.paid");
      expect(event!.gatewayId).toBe("MOCK123");
      expect(event!.paidAt).toBeInstanceOf(Date);
      expect(event!.paidAmount).toBe(10000);
    });

    it("usa defaults quando campos ausentes", () => {
      const event = provider.parseWebhookEvent(JSON.stringify({}));
      expect(event!.gatewayId).toBe("mock-gateway-id");
      expect(event!.paidAmount).toBe(0);
    });
  });

  describe("testConnection", () => {
    it("retorna ok: true", async () => {
      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.message).toContain("Mock");
    });
  });
});
