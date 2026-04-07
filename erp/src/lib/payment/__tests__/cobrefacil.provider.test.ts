import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CobreFacilProvider } from "@/lib/payment/providers/cobrefacil.provider";
import {
  clearTokenCache,
} from "@/lib/payment/providers/cobrefacil-auth";
import { makeCreateBoletoInput } from "./helpers";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CREDS = { appId: "app_test_123", secret: "sec_test_456" };

/** Builds a mock Response for fetch */
function mockResponse(
  body: unknown,
  status = 200,
  ok = true,
): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    clone: () => mockResponse(body, status, ok),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response;
}

/** Standard auth response */
function authResponse() {
  return mockResponse({
    success: true,
    data: { token: "tok_abc123", expiration: 3600 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CobreFacilProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────

  describe("constructor", () => {
    it("throws se appId vazio", () => {
      expect(() => new CobreFacilProvider({ appId: "", secret: "sec" })).toThrow(
        "appId é obrigatório",
      );
    });

    it("throws se secret vazio", () => {
      expect(() => new CobreFacilProvider({ appId: "app", secret: "" })).toThrow(
        "secret é obrigatório",
      );
    });

    it("cria instância com credenciais válidas", () => {
      expect(new CobreFacilProvider(CREDS)).toBeInstanceOf(CobreFacilProvider);
    });

    it("aceita metadata null", () => {
      expect(new CobreFacilProvider(CREDS, null)).toBeInstanceOf(
        CobreFacilProvider,
      );
    });

    it("aceita metadata com todas as opções", () => {
      expect(
        new CobreFacilProvider(CREDS, {
          defaultPaymentMethod: "pix",
          finePercentage: 2,
          interestPercentage: 1,
          discountPercentage: 5,
          discountDays: 10,
        }),
      ).toBeInstanceOf(CobreFacilProvider);
    });
  });

  // ─────────────────────────────────────────────
  // Token caching & refresh (via cobrefacil-auth)
  // ─────────────────────────────────────────────

  describe("token caching", () => {
    it("reutiliza token em cache entre chamadas", async () => {
      const provider = new CobreFacilProvider(CREDS);
      let authCalls = 0;

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/authenticate")) {
          authCalls++;
          return authResponse();
        }
        return mockResponse({
          success: true,
          data: { id: "inv_1", status: "pending" },
        });
      });

      // Two calls should only authenticate once
      await provider.getBoletoStatus("inv_1");
      await provider.getBoletoStatus("inv_2");

      expect(authCalls).toBe(1);
    });

    it("renova token em 401 (auto-retry)", async () => {
      const provider = new CobreFacilProvider(CREDS);
      let authCalls = 0;
      let invoiceCalls = 0;

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/authenticate")) {
          authCalls++;
          return authResponse();
        }

        if (urlStr.includes("/invoices")) {
          invoiceCalls++;
          // First invoice call returns 401, second succeeds
          if (invoiceCalls === 1) {
            return mockResponse({ success: false, message: "Unauthorized" }, 401, false);
          }
          return mockResponse({
            success: true,
            data: { id: "inv_1", status: "pending" },
          });
        }

        return mockResponse({ success: true, data: [] });
      });

      const result = await provider.getBoletoStatus("inv_1");

      // Should have authenticated twice (initial + retry after 401)
      expect(authCalls).toBe(2);
      expect(result.gatewayId).toBe("inv_1");
    });
  });

  // ─────────────────────────────────────────────
  // ensureCustomer
  // ─────────────────────────────────────────────

  describe("ensureCustomer", () => {
    it("retorna customer existente sem criar novo", async () => {
      const provider = new CobreFacilProvider(CREDS);
      let createCalled = false;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/authenticate")) return authResponse();

        if (urlStr.includes("/customers") && (!init?.method || init.method === "GET")) {
          return mockResponse({
            success: true,
            data: [{ id: "cust_existing_123" }],
          });
        }

        if (urlStr.includes("/customers") && init?.method === "POST") {
          createCalled = true;
          return mockResponse({ success: true, data: { id: "cust_new" } });
        }

        return mockResponse({ success: true, data: {} });
      });

      const customerId = await // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provider as any).ensureCustomer({
        name: "João",
        document: "12345678901",
        documentType: "cpf",
      });

      expect(customerId).toBe("cust_existing_123");
      expect(createCalled).toBe(false);
    });

    it("cria customer quando não encontra existente", async () => {
      const provider = new CobreFacilProvider(CREDS);
      let createPayload: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/authenticate")) return authResponse();

        if (urlStr.includes("/customers") && (!init?.method || init.method === "GET")) {
          // Search returns empty
          return mockResponse({ success: true, data: [] });
        }

        if (urlStr.includes("/customers") && init?.method === "POST") {
          createPayload = JSON.parse(init.body as string);
          return mockResponse({
            success: true,
            data: { id: "cust_new_456" },
          });
        }

        return mockResponse({ success: true, data: {} });
      });

      const customerId = await // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provider as any).ensureCustomer({
        name: "Maria LTDA",
        document: "12345678000199",
        documentType: "cnpj",
        email: "maria@ltda.com",
        address: {
          street: "Rua Teste",
          number: "100",
          complement: "Sala 1",
          neighborhood: "Centro",
          city: "Campinas",
          state: "SP",
          zipCode: "13000-000",
        },
      });

      expect(customerId).toBe("cust_new_456");
      expect(createPayload).not.toBeNull();
      expect(createPayload!.person_type).toBe(2); // CNPJ = person_type 2
      expect(createPayload!.ein).toBe("12345678000199");
      expect(createPayload!.company_name).toBe("Maria LTDA");
      expect((createPayload!.address as Record<string, unknown>).zipcode).toBe("13000000");
    });

    it("usa endereço placeholder quando customer não tem endereço", async () => {
      const provider = new CobreFacilProvider(CREDS);
      let createPayload: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/authenticate")) return authResponse();

        if (urlStr.includes("/customers") && (!init?.method || init.method === "GET")) {
          return mockResponse({ success: true, data: [] });
        }

        if (urlStr.includes("/customers") && init?.method === "POST") {
          createPayload = JSON.parse(init.body as string);
          return mockResponse({ success: true, data: { id: "cust_placeholder" } });
        }

        return mockResponse({ success: true, data: {} });
      });

      await // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provider as any).ensureCustomer({
        name: "Sem Endereço",
        document: "11122233344",
        documentType: "cpf",
      });

      expect(createPayload).not.toBeNull();
      expect((createPayload!.address as Record<string, unknown>).zipcode).toBe("01001000");
      expect((createPayload!.address as Record<string, unknown>).city).toBe("São Paulo");
    });

    it("usa company address config quando fornecido na metadata", async () => {
      const companyAddress = {
        zipCode: "09000000",
        street: "Avenida Getúlio Vargas",
        number: "1000",
        complement: "Apto 200",
        neighborhood: "Centro",
        city: "Santo André",
        state: "SP",
      };

      const provider = new CobreFacilProvider(CREDS, {
        companyAddress,
      });
      let createPayload: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/authenticate")) return authResponse();

        if (urlStr.includes("/customers") && (!init?.method || init.method === "GET")) {
          return mockResponse({ success: true, data: [] });
        }

        if (urlStr.includes("/customers") && init?.method === "POST") {
          createPayload = JSON.parse(init.body as string);
          return mockResponse({ success: true, data: { id: "cust_with_config" } });
        }

        return mockResponse({ success: true, data: {} });
      });

      await // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provider as any).ensureCustomer({
        name: "Empresa com Config",
        document: "12345678901",
        documentType: "cpf",
      });

      expect(createPayload).not.toBeNull();
      expect((createPayload!.address as Record<string, unknown>).zipcode).toBe("09000000");
      expect((createPayload!.address as Record<string, unknown>).street).toBe("Avenida Getúlio Vargas");
      expect((createPayload!.address as Record<string, unknown>).city).toBe("Santo André");
      expect((createPayload!.address as Record<string, unknown>).complement).toBe("Apto 200");
    });

    it("customer address sobrescreve company address config", async () => {
      const companyAddress = {
        zipCode: "09000000",
        street: "Company Street",
        number: "999",
        neighborhood: "Company Neighborhood",
        city: "Company City",
        state: "SP",
      };

      const provider = new CobreFacilProvider(CREDS, {
        companyAddress,
      });
      let createPayload: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/authenticate")) return authResponse();

        if (urlStr.includes("/customers") && (!init?.method || init.method === "GET")) {
          return mockResponse({ success: true, data: [] });
        }

        if (urlStr.includes("/customers") && init?.method === "POST") {
          createPayload = JSON.parse(init.body as string);
          return mockResponse({ success: true, data: { id: "cust_override" } });
        }

        return mockResponse({ success: true, data: {} });
      });

      await // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provider as any).ensureCustomer({
        name: "Override Test",
        document: "12345678901",
        documentType: "cpf",
        address: {
          street: "Customer Street",
          number: "100",
          neighborhood: "Customer Neighborhood",
          city: "Customer City",
          state: "RJ",
          zipCode: "20000000",
        },
      });

      expect(createPayload).not.toBeNull();
      // Customer address should take precedence
      expect((createPayload!.address as Record<string, unknown>).zipcode).toBe("20000000");
      expect((createPayload!.address as Record<string, unknown>).street).toBe("Customer Street");
      expect((createPayload!.address as Record<string, unknown>).city).toBe("Customer City");
      expect((createPayload!.address as Record<string, unknown>).state).toBe("RJ");
    });
  });

  // ─────────────────────────────────────────────
  // createBoleto
  // ─────────────────────────────────────────────

  describe("createBoleto", () => {
    it("cria boleto com sucesso (customer existente)", async () => {
      const provider = new CobreFacilProvider(CREDS, {
        defaultPaymentMethod: "bankslip",
        finePercentage: 2,
        interestPercentage: 1,
      });

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/authenticate")) return authResponse();

        // Customer search — return existing
        if (urlStr.includes("/customers")) {
          return mockResponse({
            success: true,
            data: [{ id: "cust_123" }],
          });
        }

        // Invoice creation
        if (urlStr.includes("/invoices") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          // Verify price is in reais (10000 centavos = 100 reais)
          expect(body.price).toBe(100);
          expect(body.payable_with).toBe("bankslip");
          expect(body.customer_id).toBe("cust_123");
          expect(body.settings.late_fee.value).toBe(2);
          expect(body.settings.interest.value).toBe(1);

          return mockResponse({
            success: true,
            data: {
              id: "inv_abc",
              status: "pending",
              url: "https://cobrefacil.com.br/pay/inv_abc",
              barcode: "12345.67890 12345.67890 12345.67890 1 12340000010000",
              barcode_data: "12345678901234567890123456789012345678901234567",
              pix_qrcode: "00020126580014br.gov.bcb.pix",
            },
          });
        }

        return mockResponse({ success: true, data: {} });
      });

      const result = await provider.createBoleto(makeCreateBoletoInput());

      expect(result.gatewayId).toBe("inv_abc");
      expect(result.url).toBe("https://cobrefacil.com.br/pay/inv_abc");
      expect(result.barcode).toBeDefined();
      expect(result.line).toBeDefined();
      expect(result.qrCode).toBe("00020126580014br.gov.bcb.pix");
      expect(result.nossoNumero).toBe("inv_abc");
    });

    it("converte amount de centavos para reais", async () => {
      const provider = new CobreFacilProvider(CREDS);
      let invoiceBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/authenticate")) return authResponse();
        if (urlStr.includes("/customers")) {
          return mockResponse({ success: true, data: [{ id: "cust_1" }] });
        }
        if (urlStr.includes("/invoices") && init?.method === "POST") {
          invoiceBody = JSON.parse(init.body as string);
          return mockResponse({
            success: true,
            data: { id: "inv_1", status: "pending" },
          });
        }
        return mockResponse({ success: true, data: {} });
      });

      // 15050 centavos = R$ 150.50
      await provider.createBoleto(makeCreateBoletoInput({ amount: 15050 }));
      expect(invoiceBody!.price).toBe(150.5);
    });
  });

  // ─────────────────────────────────────────────
  // getBoletoStatus
  // ─────────────────────────────────────────────

  describe("getBoletoStatus", () => {
    it("retorna status mapeado corretamente", async () => {
      const provider = new CobreFacilProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/authenticate")) return authResponse();
        return mockResponse({
          success: true,
          data: {
            id: "inv_paid",
            status: "paid",
            paid_at: "2026-03-20T10:00:00Z",
            total_paid: 100.5,
          },
        });
      });

      const result = await provider.getBoletoStatus("inv_paid");
      expect(result.status).toBe("paid");
      expect(result.paidAt).toBeInstanceOf(Date);
      // 100.50 reais → 10050 centavos
      expect(result.paidAmount).toBe(10050);
    });

    it("mapeia status canceled → cancelled", async () => {
      const provider = new CobreFacilProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/authenticate")) return authResponse();
        return mockResponse({
          success: true,
          data: { id: "inv_cancel", status: "canceled" },
        });
      });

      const result = await provider.getBoletoStatus("inv_cancel");
      expect(result.status).toBe("cancelled");
    });

    it("mapeia status desconhecido → pending (fallback)", async () => {
      const provider = new CobreFacilProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/authenticate")) return authResponse();
        return mockResponse({
          success: true,
          data: { id: "inv_unknown", status: "processing_something" },
        });
      });

      const result = await provider.getBoletoStatus("inv_unknown");
      expect(result.status).toBe("pending");
    });
  });

  // ─────────────────────────────────────────────
  // cancelBoleto
  // ─────────────────────────────────────────────

  describe("cancelBoleto", () => {
    it("retorna success: true no cancelamento", async () => {
      const provider = new CobreFacilProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/authenticate")) return authResponse();
        return mockResponse({ success: true, data: {} });
      });

      const result = await provider.cancelBoleto("inv_cancel");
      expect(result.success).toBe(true);
    });

    it("retorna success: false em caso de erro da API", async () => {
      const provider = new CobreFacilProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/authenticate")) return authResponse();
        return mockResponse(
          { success: false, message: "Invoice not found" },
          404,
          true, // ok=true because our api() checks json.success
        );
      });

      const result = await provider.cancelBoleto("inv_notfound");
      expect(result.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // validateWebhook
  // ─────────────────────────────────────────────

  describe("validateWebhook", () => {
    const provider = new CobreFacilProvider(CREDS);

    it("retorna true para payload válido com event + data", () => {
      const body = JSON.stringify({
        event: "invoice.paid",
        data: { id: "inv_1", status: "paid" },
      });
      expect(provider.validateWebhook({}, body)).toBe(true);
    });

    it("retorna false para payload sem event", () => {
      const body = JSON.stringify({ data: { id: "inv_1" } });
      expect(provider.validateWebhook({}, body)).toBe(false);
    });

    it("retorna false para payload sem data", () => {
      const body = JSON.stringify({ event: "invoice.paid" });
      expect(provider.validateWebhook({}, body)).toBe(false);
    });

    it("retorna false para JSON inválido", () => {
      expect(provider.validateWebhook({}, "not json at all")).toBe(false);
    });

    it("retorna false para body vazio", () => {
      expect(provider.validateWebhook({}, "")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // parseWebhookEvent
  // ─────────────────────────────────────────────

  describe("parseWebhookEvent", () => {
    const provider = new CobreFacilProvider(CREDS);

    it("mapeia invoice.paid → boleto.paid", () => {
      const body = JSON.stringify({
        event: "invoice.paid",
        data: {
          id: "inv_123",
          status: "paid",
          paid_at: "2026-03-20T10:00:00Z",
          total_paid: 100.0,
        },
      });
      const event = provider.parseWebhookEvent(body);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("boleto.paid");
      expect(event!.gatewayId).toBe("inv_123");
      expect(event!.paidAt).toBeInstanceOf(Date);
      // 100.0 reais → 10000 centavos
      expect(event!.paidAmount).toBe(10000);
    });

    it("mapeia invoice.canceled → boleto.cancelled", () => {
      const body = JSON.stringify({
        event: "invoice.canceled",
        data: { id: "inv_456", status: "canceled" },
      });
      const event = provider.parseWebhookEvent(body);
      expect(event!.type).toBe("boleto.cancelled");
    });

    it("mapeia invoice.refunded → boleto.cancelled", () => {
      const body = JSON.stringify({
        event: "invoice.refunded",
        data: { id: "inv_ref", status: "refunded" },
      });
      expect(provider.parseWebhookEvent(body)!.type).toBe("boleto.cancelled");
    });

    it("mapeia invoice.reversed → boleto.failed", () => {
      const body = JSON.stringify({
        event: "invoice.reversed",
        data: { id: "inv_rev", status: "reversed" },
      });
      expect(provider.parseWebhookEvent(body)!.type).toBe("boleto.failed");
    });

    it("mapeia invoice.declined → boleto.failed", () => {
      const body = JSON.stringify({
        event: "invoice.declined",
        data: { id: "inv_dec", status: "declined" },
      });
      expect(provider.parseWebhookEvent(body)!.type).toBe("boleto.failed");
    });

    it("retorna null para event type desconhecido", () => {
      const body = JSON.stringify({
        event: "invoice.created",
        data: { id: "inv_new", status: "pending" },
      });
      expect(provider.parseWebhookEvent(body)).toBeNull();
    });

    it("retorna null para JSON inválido", () => {
      expect(provider.parseWebhookEvent("not json")).toBeNull();
    });

    it("preserva rawEvent completo", () => {
      const body = JSON.stringify({
        event: "invoice.paid",
        data: { id: "inv_raw", status: "paid", custom_field: "value" },
      });
      const event = provider.parseWebhookEvent(body);
      expect((event!.rawEvent as Record<string, unknown>).event).toBe(
        "invoice.paid",
      );
    });

    it("converte total_paid de reais para centavos", () => {
      const body = JSON.stringify({
        event: "invoice.paid",
        data: { id: "inv_conv", status: "paid", total_paid: 250.75 },
      });
      const event = provider.parseWebhookEvent(body);
      expect(event!.paidAmount).toBe(25075);
    });
  });

  // ─────────────────────────────────────────────
  // testConnection
  // ─────────────────────────────────────────────

  describe("testConnection", () => {
    it("retorna ok: true quando API responde com sucesso", async () => {
      const provider = new CobreFacilProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/authenticate")) return authResponse();
        return mockResponse({ success: true, data: [] });
      });

      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.message).toContain("sucesso");
    });

    it("retorna ok: false quando autenticação falha", async () => {
      const provider = new CobreFacilProvider(CREDS);

      globalThis.fetch = vi.fn(async () =>
        mockResponse(
          { success: false, message: "Invalid credentials" },
          401,
          false,
        ),
      );

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
    });

    it("retorna ok: false quando API retorna success: false", async () => {
      const provider = new CobreFacilProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/authenticate")) return authResponse();
        return mockResponse({ success: false, message: "Account suspended" });
      });

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Account suspended");
    });
  });
});
