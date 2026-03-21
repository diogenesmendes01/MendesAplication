import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { PagarmeProvider } from "@/lib/payment/providers/pagarme.provider";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("PagarmeProvider", () => {
  describe("constructor", () => {
    it("throw se apiKey vazio", () => {
      expect(() => new PagarmeProvider({ apiKey: "" })).toThrow("apiKey é obrigatória");
    });

    it("cria instância com apiKey válida", () => {
      expect(new PagarmeProvider({ apiKey: "sk_test_abc" })).toBeInstanceOf(PagarmeProvider);
    });

    it("usa defaults quando metadata é null", () => {
      expect(new PagarmeProvider({ apiKey: "sk_test_abc" }, null)).toBeInstanceOf(PagarmeProvider);
    });

    it("aceita metadata com defaultInstructions e daysToExpire", () => {
      expect(
        new PagarmeProvider({ apiKey: "sk_test_abc" }, { defaultInstructions: "Custom", daysToExpire: 10 }),
      ).toBeInstanceOf(PagarmeProvider);
    });
  });

  describe("validateWebhook", () => {
    const secret = "my-webhook-secret";
    let provider: PagarmeProvider;

    beforeEach(() => {
      provider = new PagarmeProvider({ apiKey: "sk_test_abc" }, null, secret);
    });

    it("retorna true para HMAC sha1 válido", () => {
      const body = '{"type":"charge.paid","data":{"id":"ch_123"}}';
      const hmac = crypto.createHmac("sha1", secret);
      hmac.update(body, "utf8");
      const signature = `sha1=${hmac.digest("hex")}`;

      expect(provider.validateWebhook({ "x-hub-signature": signature }, body)).toBe(true);
    });

    it("retorna false para signature inválida", () => {
      expect(provider.validateWebhook({ "x-hub-signature": "sha1=invalidhash" }, '{"type":"charge.paid"}')).toBe(false);
    });

    it("retorna false sem webhookSecret configurado", () => {
      const noSecret = new PagarmeProvider({ apiKey: "sk_test_abc" }, null, undefined);
      expect(noSecret.validateWebhook({ "x-hub-signature": "sha1=anything" }, "body")).toBe(false);
    });

    it("retorna false sem header x-hub-signature", () => {
      expect(provider.validateWebhook({}, "body")).toBe(false);
    });

    it("retorna false quando signature tem tamanho diferente", () => {
      expect(provider.validateWebhook({ "x-hub-signature": "sha1=abc" }, "body")).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    let provider: PagarmeProvider;

    beforeEach(() => {
      provider = new PagarmeProvider({ apiKey: "sk_test_abc" });
    });

    it("mapeia charge.paid → boleto.paid", () => {
      const body = JSON.stringify({
        type: "charge.paid",
        data: { id: "ch_123", status: "paid", paid_at: "2026-03-20T10:00:00Z", paid_amount: 10000 },
      });
      const event = provider.parseWebhookEvent(body);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("boleto.paid");
      expect(event!.gatewayId).toBe("ch_123");
      expect(event!.paidAmount).toBe(10000);
      expect(event!.paidAt).toBeInstanceOf(Date);
    });

    it("mapeia charge.canceled → boleto.cancelled", () => {
      const body = JSON.stringify({ type: "charge.canceled", data: { id: "ch_456", status: "canceled" } });
      const event = provider.parseWebhookEvent(body);
      expect(event!.type).toBe("boleto.cancelled");
    });

    it("mapeia charge.payment_failed → boleto.failed", () => {
      const body = JSON.stringify({ type: "charge.payment_failed", data: { id: "ch_789", status: "failed" } });
      expect(provider.parseWebhookEvent(body)!.type).toBe("boleto.failed");
    });

    it("mapeia charge.overpaid → boleto.paid com flag _isOverpaid", () => {
      const body = JSON.stringify({
        type: "charge.overpaid",
        data: { id: "ch_over", status: "overpaid", paid_at: "2026-03-20T10:00:00Z", paid_amount: 15000 },
      });
      const event = provider.parseWebhookEvent(body);
      expect(event!.type).toBe("boleto.paid");
      expect((event!.rawEvent as Record<string, unknown>)._isOverpaid).toBe(true);
    });

    it("retorna null para event type desconhecido (charge.created)", () => {
      const body = JSON.stringify({ type: "charge.created", data: { id: "ch_new", status: "pending" } });
      expect(provider.parseWebhookEvent(body)).toBeNull();
    });

    it("retorna null para charge.pending", () => {
      const body = JSON.stringify({ type: "charge.pending", data: { id: "ch_pend", status: "pending" } });
      expect(provider.parseWebhookEvent(body)).toBeNull();
    });

    it("mapeia charge.underpaid → boleto.failed", () => {
      const body = JSON.stringify({ type: "charge.underpaid", data: { id: "ch_under", status: "underpaid" } });
      expect(provider.parseWebhookEvent(body)!.type).toBe("boleto.failed");
    });

    it("_isOverpaid é false para eventos não-overpaid", () => {
      const body = JSON.stringify({ type: "charge.paid", data: { id: "ch_normal", status: "paid", paid_amount: 10000 } });
      const event = provider.parseWebhookEvent(body);
      expect((event!.rawEvent as Record<string, unknown>)._isOverpaid).toBe(false);
    });
  });

  describe("createBoleto", () => {
    let provider: PagarmeProvider;
    const originalFetch = globalThis.fetch;

    beforeEach(() => { provider = new PagarmeProvider({ apiKey: "sk_test_abc" }); });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it("cria boleto com sucesso via fetch mockado", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true, status: 200,
            json: async () => ({ data: [{ id: "cust_123", name: "João", email: "j@test.com", document: "12345678901", type: "individual" }] }),
          } as Response;
        }
        return {
          ok: true, status: 200,
          json: async () => ({
            id: "or_abc", status: "pending",
            charges: [{ id: "ch_abc", status: "pending", last_transaction: { url: "https://pagar.me/boleto/123", line: "12345", barcode: "67890", nosso_numero: "NR123" } }],
          }),
        } as Response;
      });

      const result = await provider.createBoleto({
        customer: { name: "João", document: "12345678901", documentType: "cpf", email: "j@test.com" },
        amount: 10000, dueDate: new Date("2026-04-01"),
      });

      expect(result.gatewayId).toBe("ch_abc");
      expect(result.url).toBe("https://pagar.me/boleto/123");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("throw quando resposta não contém charges", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/customers")) {
          return { ok: true, status: 200, json: async () => ({ data: [{ id: "cust_123" }] }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ id: "or_abc", status: "pending", charges: [] }) } as Response;
      });

      await expect(
        provider.createBoleto({
          customer: { name: "João", document: "12345678901", documentType: "cpf" },
          amount: 10000, dueDate: new Date("2026-04-01"),
        }),
      ).rejects.toThrow("não contém charges");
    });
  });

  describe("getBoletoStatus", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it("retorna status mapeado corretamente", async () => {
      const provider = new PagarmeProvider({ apiKey: "sk_test_abc" });
      globalThis.fetch = vi.fn(async () => ({
        ok: true, status: 200,
        json: async () => ({ id: "ch_123", status: "paid", paid_at: "2026-03-20T10:00:00Z", paid_amount: 10000 }),
      })) as typeof fetch;

      const result = await provider.getBoletoStatus("ch_123");
      expect(result.status).toBe("paid");
      expect(result.paidAt).toBeInstanceOf(Date);
      expect(result.paidAmount).toBe(10000);
    });
  });

  describe("cancelBoleto", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it("retorna success: true no cancelamento", async () => {
      const provider = new PagarmeProvider({ apiKey: "sk_test_abc" });
      globalThis.fetch = vi.fn(async () => ({ ok: true, status: 204 })) as typeof fetch;
      expect((await provider.cancelBoleto("ch_123")).success).toBe(true);
    });

    it("throw com mensagem descritiva em caso de erro", async () => {
      const provider = new PagarmeProvider({ apiKey: "sk_test_abc" });
      globalThis.fetch = vi.fn(async () => ({
        ok: false, status: 404, statusText: "Not Found", json: async () => ({ message: "Charge not found" }),
      })) as typeof fetch;
      await expect(provider.cancelBoleto("ch_nope")).rejects.toThrow("falha ao cancelar");
    });
  });

  describe("testConnection", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it("retorna ok: true quando API responde", async () => {
      const provider = new PagarmeProvider({ apiKey: "sk_test_abc" });
      globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })) as typeof fetch;
      expect((await provider.testConnection()).ok).toBe(true);
    });

    it("retorna ok: false em caso de erro", async () => {
      const provider = new PagarmeProvider({ apiKey: "sk_test_abc" });
      globalThis.fetch = vi.fn(async () => ({
        ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ message: "Invalid key" }),
      })) as typeof fetch;
      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Falha");
    });
  });
});
