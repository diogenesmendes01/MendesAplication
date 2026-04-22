import { describe, it, expect, vi, afterEach } from "vitest";
import { VindiProvider } from "@/lib/payment/providers/vindi.provider";
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

const API_KEY = "test_api_key_123";

/** Builds a mock Response for fetch */
function mockResponse(body: unknown, status = 200, ok = true): Response {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VindiProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─────────────────────────────────────────────
  // Constructor & Auth
  // ─────────────────────────────────────────────

  describe("constructor", () => {
    it("throws se apiKey vazio", () => {
      expect(
        () => new VindiProvider({ apiKey: "" }),
      ).toThrow("apiKey é obrigatório");
    });

    it("cria instância com credenciais válidas", () => {
      expect(new VindiProvider({ apiKey: API_KEY })).toBeInstanceOf(
        VindiProvider,
      );
    });

    it("aceita metadata null", () => {
      expect(new VindiProvider({ apiKey: API_KEY }, null)).toBeInstanceOf(
        VindiProvider,
      );
    });

    it("aceita metadata com defaultPaymentMethodCode", () => {
      expect(
        new VindiProvider({ apiKey: API_KEY }, {
          defaultPaymentMethodCode: "pix",
        }),
      ).toBeInstanceOf(VindiProvider);
    });
  });

  describe("auth header format (RFC2617)", () => {
    it("inclui ':' após apiKey no header Authorization", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      let capturedAuthHeader = "";

      globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        capturedAuthHeader = headers?.Authorization ?? "";
        return mockResponse({ merchant: { name: "Test Merchant" } });
      });

      await provider.testConnection();

      // Decode and verify the ":" is present
      const base64Part = capturedAuthHeader.replace("Basic ", "");
      const decoded = Buffer.from(base64Part, "base64").toString("utf-8");
      expect(decoded).toBe(`${API_KEY}:`);
      expect(decoded.endsWith(":")).toBe(true);
    });

    it("usa sandbox URL quando sandbox=true", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY, sandbox: true });
      let capturedUrl = "";

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        capturedUrl = typeof url === "string" ? url : url.toString();
        return mockResponse({ merchant: { name: "Sandbox" } });
      });

      await provider.testConnection();
      expect(capturedUrl).toContain("sandbox-app.vindi.com.br");
    });

    it("usa prod URL quando sandbox=false", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY, sandbox: false });
      let capturedUrl = "";

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        capturedUrl = typeof url === "string" ? url : url.toString();
        return mockResponse({ merchant: { name: "Prod" } });
      });

      await provider.testConnection();
      expect(capturedUrl).toContain("app.vindi.com.br/api/v1");
      expect(capturedUrl).not.toContain("sandbox");
    });
  });

  // ─────────────────────────────────────────────
  // ensureCustomer
  // ─────────────────────────────────────────────

  describe("ensureCustomer", () => {
    it("retorna customer existente sem criar novo", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      let createCalled = false;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/customers") && (!init?.method || init.method === "GET")) {
          return mockResponse({ customers: [{ id: 42 }] });
        }

        if (urlStr.includes("/customers") && init?.method === "POST") {
          createCalled = true;
          return mockResponse({ customer: { id: 99 } });
        }

        return mockResponse({});
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customerId = await (provider as any).ensureCustomer({
        name: "João",
        document: "12345678901",
        documentType: "cpf",
      });

      expect(customerId).toBe(42);
      expect(createCalled).toBe(false);
    });

    it("cria customer quando não encontra existente", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      let createPayload: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/customers") && (!init?.method || init.method === "GET")) {
          return mockResponse({ customers: [] });
        }

        if (urlStr.includes("/customers") && init?.method === "POST") {
          createPayload = JSON.parse(init.body as string);
          return mockResponse({ customer: { id: 77 } });
        }

        return mockResponse({});
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customerId = await (provider as any).ensureCustomer({
        name: "Maria LTDA",
        document: "12.345.678/0001-99",
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

      expect(customerId).toBe(77);
      expect(createPayload).not.toBeNull();
      expect(createPayload!.registry_code).toBe("12345678000199");
      expect(createPayload!.name).toBe("Maria LTDA");
      expect(createPayload!.email).toBe("maria@ltda.com");
      expect(
        (createPayload!.address as Record<string, unknown>).zipcode,
      ).toBe("13000000");
    });

    it("busca por registry_code na query string", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      let capturedSearchUrl = "";

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/customers?")) {
          capturedSearchUrl = urlStr;
        }
        return mockResponse({ customers: [{ id: 1 }] });
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (provider as any).ensureCustomer({
        name: "Test",
        document: "123.456.789-01",
        documentType: "cpf",
      });

      expect(capturedSearchUrl).toContain(
        "query=registry_code=12345678901",
      );
    });
  });

  // ─────────────────────────────────────────────
  // createBoleto
  // ─────────────────────────────────────────────

  describe("createBoleto", () => {
    it("cria boleto com sucesso (customer existente)", async () => {
      const provider = new VindiProvider(
        { apiKey: API_KEY },
        { defaultPaymentMethodCode: "bank_slip" },
      );

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        // Customer search — return existing
        if (urlStr.includes("/customers")) {
          return mockResponse({ customers: [{ id: 42 }] });
        }

        // Bill creation
        if (urlStr.includes("/bills") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          // Verify amount is in reais (10000 centavos = 100 reais)
          expect(body.bill_items[0].amount).toBe(100);
          expect(body.payment_method_code).toBe("bank_slip");
          expect(body.customer_id).toBe(42);

          return mockResponse({
            bill: {
              id: 12345,
              code: null,
              status: "pending",
              url: "https://app.vindi.com.br/bills/12345",
              charges: [
                {
                  id: 1,
                  status: "pending",
                  payment_method: { code: "bank_slip" },
                  print_url: "https://app.vindi.com.br/charges/1/print",
                  last_transaction: {
                    gateway_response_fields: {
                      typeable_barcode: "12345.67890 12345.67890 12345.67890 1 12340000010000",
                      barcode: "12345678901234567890123456789012345678901234567",
                      pix_code: "00020126580014br.gov.bcb.pix",
                    },
                  },
                },
              ],
            },
          });
        }

        return mockResponse({});
      });

      const result = await provider.createBoleto(makeCreateBoletoInput());

      expect(result.gatewayId).toBe("12345");
      expect(result.url).toBe("https://app.vindi.com.br/bills/12345");
      expect(result.barcode).toBeDefined();
      expect(result.line).toBeDefined();
      expect(result.qrCode).toBe("00020126580014br.gov.bcb.pix");
      expect(result.pdf).toBe("https://app.vindi.com.br/charges/1/print");
      expect(result.nossoNumero).toBe("12345");
    });

    it("converte amount de centavos para reais", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      let billBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/customers")) {
          return mockResponse({ customers: [{ id: 1 }] });
        }
        if (urlStr.includes("/bills") && init?.method === "POST") {
          billBody = JSON.parse(init.body as string);
          return mockResponse({
            bill: {
              id: 1,
              code: null,
              status: "pending",
              url: "",
              charges: [],
            },
          });
        }
        return mockResponse({});
      });

      // 15050 centavos = R$ 150.50
      await provider.createBoleto(makeCreateBoletoInput({ amount: 15050 }));
      expect(
        (billBody!.bill_items as Array<{ amount: number }>)[0].amount,
      ).toBe(150.5);
    });

    it("usa bank_slip como default quando metadata não especifica", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      let billBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/customers")) {
          return mockResponse({ customers: [{ id: 1 }] });
        }
        if (urlStr.includes("/bills") && init?.method === "POST") {
          billBody = JSON.parse(init.body as string);
          return mockResponse({
            bill: {
              id: 1,
              code: null,
              status: "pending",
              url: "",
              charges: [],
            },
          });
        }
        return mockResponse({});
      });

      await provider.createBoleto(makeCreateBoletoInput());
      expect(billBody!.payment_method_code).toBe("bank_slip");
    });
  });

  // ─────────────────────────────────────────────
  // getBoletoStatus
  // ─────────────────────────────────────────────

  describe("getBoletoStatus", () => {
    it("retorna status mapeado corretamente (paid)", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () =>
        mockResponse({
          bill: {
            id: 123,
            status: "paid",
            charges: [
              {
                paid_at: "2026-03-20T10:00:00Z",
                last_transaction: { amount: 100.5 },
              },
            ],
          },
        }),
      );

      const result = await provider.getBoletoStatus("123");
      expect(result.status).toBe("paid");
      expect(result.paidAt).toBeInstanceOf(Date);
      // 100.50 reais → 10050 centavos
      expect(result.paidAmount).toBe(10050);
    });

    it("mapeia status canceled → cancelled", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () =>
        mockResponse({
          bill: { id: 456, status: "canceled", charges: [] },
        }),
      );

      const result = await provider.getBoletoStatus("456");
      expect(result.status).toBe("cancelled");
    });

    it("mapeia status review → pending", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () =>
        mockResponse({
          bill: { id: 789, status: "review", charges: [] },
        }),
      );

      const result = await provider.getBoletoStatus("789");
      expect(result.status).toBe("pending");
    });

    it("mapeia status desconhecido → pending (fallback)", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () =>
        mockResponse({
          bill: { id: 999, status: "some_unknown_status", charges: [] },
        }),
      );

      const result = await provider.getBoletoStatus("999");
      expect(result.status).toBe("pending");
    });

    it("converte amount de reais para centavos", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () =>
        mockResponse({
          bill: {
            id: 1,
            status: "paid",
            charges: [
              {
                paid_at: "2026-03-20T10:00:00Z",
                last_transaction: { amount: 250.75 },
              },
            ],
          },
        }),
      );

      const result = await provider.getBoletoStatus("1");
      expect(result.paidAmount).toBe(25075);
    });
  });

  // ─────────────────────────────────────────────
  // cancelBoleto
  // ─────────────────────────────────────────────

  describe("cancelBoleto", () => {
    it("retorna success: true no cancelamento", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () => mockResponse({}));

      const result = await provider.cancelBoleto("123");
      expect(result.success).toBe(true);
    });

    it("retorna success: false em caso de erro da API", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () =>
        mockResponse({ errors: [{ message: "Not found" }] }, 404, false),
      );

      const result = await provider.cancelBoleto("999");
      expect(result.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // validateWebhook
  // ─────────────────────────────────────────────

  describe("validateWebhook", () => {
    it("valida com webhookSecret via HTTP Basic Auth", () => {
      const secret = "user:password123";
      const provider = new VindiProvider({ apiKey: API_KEY }, null, secret);

      const expectedAuth = `Basic ${Buffer.from(secret).toString("base64")}`;
      const body = JSON.stringify({ event: { type: "bill_paid", data: {} } });

      expect(
        provider.validateWebhook({ authorization: expectedAuth }, body),
      ).toBe(true);
    });

    it("rejeita webhookSecret inválido", () => {
      const provider = new VindiProvider(
        { apiKey: API_KEY },
        null,
        "user:correct",
      );

      const wrongAuth = `Basic ${Buffer.from("user:wrong").toString("base64")}`;
      const body = JSON.stringify({ event: { type: "bill_paid", data: {} } });

      expect(
        provider.validateWebhook({ authorization: wrongAuth }, body),
      ).toBe(false);
    });

    it("fallback: retorna true para payload com event.type + event.data", () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      const body = JSON.stringify({
        event: { type: "bill_paid", data: { bill: { id: 1 } } },
      });
      expect(provider.validateWebhook({}, body)).toBe(true);
    });

    it("fallback: retorna false para payload sem event.type", () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      const body = JSON.stringify({ event: { data: { bill: { id: 1 } } } });
      expect(provider.validateWebhook({}, body)).toBe(false);
    });

    it("fallback: retorna false para payload sem event.data", () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      const body = JSON.stringify({ event: { type: "bill_paid" } });
      expect(provider.validateWebhook({}, body)).toBe(false);
    });

    it("retorna false para JSON inválido", () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      expect(provider.validateWebhook({}, "not json")).toBe(false);
    });

    it("retorna false para body vazio", () => {
      const provider = new VindiProvider({ apiKey: API_KEY });
      expect(provider.validateWebhook({}, "")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // parseWebhookEvent
  // ─────────────────────────────────────────────

  describe("parseWebhookEvent", () => {
    const provider = new VindiProvider({ apiKey: API_KEY });

    it("mapeia bill_paid → boleto.paid", () => {
      const body = JSON.stringify({
        event: {
          type: "bill_paid",
          data: {
            bill: { id: 123, status: "paid", charges: [] },
            charge: {
              paid_at: "2026-03-20T10:00:00Z",
              last_transaction: { amount: 100.0 },
            },
          },
        },
      });

      const event = provider.parseWebhookEvent(body);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("boleto.paid");
      expect(event!.gatewayId).toBe("123");
      expect(event!.paidAt).toBeInstanceOf(Date);
      // 100.0 reais → 10000 centavos
      expect(event!.paidAmount).toBe(10000);
    });

    it("mapeia bill_canceled → boleto.cancelled", () => {
      const body = JSON.stringify({
        event: {
          type: "bill_canceled",
          data: {
            bill: { id: 456, status: "canceled" },
          },
        },
      });

      const event = provider.parseWebhookEvent(body);
      expect(event!.type).toBe("boleto.cancelled");
      expect(event!.gatewayId).toBe("456");
    });

    it("mapeia charge_rejected → boleto.failed", () => {
      const body = JSON.stringify({
        event: {
          type: "charge_rejected",
          data: {
            charge: {
              bill: { id: 789 },
              last_transaction: { amount: 50.0 },
            },
          },
        },
      });

      const event = provider.parseWebhookEvent(body);
      expect(event!.type).toBe("boleto.failed");
      expect(event!.paidAmount).toBe(5000);
    });

    it("mapeia charge_refunded → boleto.cancelled", () => {
      const body = JSON.stringify({
        event: {
          type: "charge_refunded",
          data: {
            bill: { id: 321 },
            charge: { last_transaction: { amount: 75.5 } },
          },
        },
      });

      const event = provider.parseWebhookEvent(body);
      expect(event!.type).toBe("boleto.cancelled");
      expect(event!.paidAmount).toBe(7550);
    });

    it("retorna null para event type desconhecido", () => {
      const body = JSON.stringify({
        event: {
          type: "bill_created",
          data: { bill: { id: 1 } },
        },
      });
      expect(provider.parseWebhookEvent(body)).toBeNull();
    });

    it("retorna null para JSON inválido", () => {
      expect(provider.parseWebhookEvent("not json")).toBeNull();
    });

    it("preserva rawEvent completo", () => {
      const body = JSON.stringify({
        event: {
          type: "bill_paid",
          data: {
            bill: { id: 1 },
            charge: { custom_field: "value" },
          },
        },
      });

      const event = provider.parseWebhookEvent(body);
      const raw = event!.rawEvent as { event: { type: string } };
      expect(raw.event.type).toBe("bill_paid");
    });

    it("converte amount de reais para centavos no webhook", () => {
      const body = JSON.stringify({
        event: {
          type: "bill_paid",
          data: {
            bill: { id: 1 },
            charge: {
              paid_at: "2026-03-20T10:00:00Z",
              last_transaction: { amount: 250.75 },
            },
          },
        },
      });

      const event = provider.parseWebhookEvent(body);
      expect(event!.paidAmount).toBe(25075);
    });
  });

  // ─────────────────────────────────────────────
  // testConnection
  // ─────────────────────────────────────────────

  describe("testConnection", () => {
    it("retorna ok: true com nome da empresa", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () =>
        mockResponse({ merchant: { name: "Empresa Teste LTDA" } }),
      );

      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.message).toContain("Empresa Teste LTDA");
    });

    it("retorna ok: false quando API retorna erro", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () =>
        mockResponse(
          { errors: [{ message: "Unauthorized" }] },
          401,
          false,
        ),
      );

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toContain("401");
    });

    it("retorna ok: false quando fetch falha", async () => {
      const provider = new VindiProvider({ apiKey: API_KEY });

      globalThis.fetch = vi.fn(async () => {
        throw new Error("Network error");
      });

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Network error");
    });
  });
});
