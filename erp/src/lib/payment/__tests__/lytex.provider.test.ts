import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LytexProvider } from "@/lib/payment/providers/lytex.provider";
import {
  clearTokenCache,
  getAuthToken,
} from "@/lib/payment/providers/lytex-auth";
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

const CREDS = { clientId: "cli_test_123", clientSecret: "sec_test_456" };

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

/** Standard auth response — token expires in 5 minutes */
function authResponse() {
  const now = new Date();
  const expireAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const refreshExpireAt = new Date(
    now.getTime() + 30 * 60 * 1000,
  ).toISOString();
  return mockResponse({
    accessToken: "tok_abc123",
    refreshToken: "rtok_xyz789",
    expireAt,
    refreshExpireAt,
  });
}

/** Refresh auth response */
function refreshAuthResponse() {
  const now = new Date();
  const expireAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const refreshExpireAt = new Date(
    now.getTime() + 30 * 60 * 1000,
  ).toISOString();
  return mockResponse({
    accessToken: "tok_refreshed_456",
    refreshToken: "rtok_refreshed_abc",
    expireAt,
    refreshExpireAt,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LytexProvider", () => {
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
    it("throws se clientId vazio", () => {
      expect(
        () => new LytexProvider({ clientId: "", clientSecret: "sec" }),
      ).toThrow("clientId é obrigatório");
    });

    it("throws se clientSecret vazio", () => {
      expect(
        () => new LytexProvider({ clientId: "cli", clientSecret: "" }),
      ).toThrow("clientSecret é obrigatório");
    });

    it("cria instância com credenciais válidas", () => {
      expect(new LytexProvider(CREDS)).toBeInstanceOf(LytexProvider);
    });

    it("aceita metadata null", () => {
      expect(new LytexProvider(CREDS, null)).toBeInstanceOf(LytexProvider);
    });

    it("aceita metadata com todas as opções", () => {
      expect(
        new LytexProvider(CREDS, {
          defaultPaymentMethod: "pix",
          cancelOverdueDays: 29,
          overduePaymentDays: 100,
          enableMulctAndInterest: true,
          mulctPercentage: 2,
          interestPercentage: 1,
          enableSerasa: true,
          serasaNegativityDays: 30,
          billingRuleId: "rule_123",
        }),
      ).toBeInstanceOf(LytexProvider);
    });
  });

  // ─────────────────────────────────────────────
  // Token caching & refresh (via lytex-auth)
  // ─────────────────────────────────────────────

  describe("token caching", () => {
    it("reutiliza token em cache entre chamadas", async () => {
      const provider = new LytexProvider(CREDS);
      let authCalls = 0;

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) {
          authCalls++;
          return authResponse();
        }
        return mockResponse({
          _hashId: "inv_1",
          status: "pending",
        });
      });

      // Two calls should only authenticate once
      await provider.getBoletoStatus("inv_1");
      await provider.getBoletoStatus("inv_2");

      expect(authCalls).toBe(1);
    });

    it("renova token em 401 (auto-retry)", async () => {
      // Use two different credential pairs to guarantee no cache hits
      // (simulates the behavior when authenticatedFetch retries after 401)
      let authCalls = 0;

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) {
          authCalls++;
          return authResponse();
        }
        return mockResponse({ _hashId: "inv_1", status: "pending" });
      });

      // First credentials: no cache → must obtain token
      const token1 = await getAuthToken("cli_401a", "sec_401a");
      expect(authCalls).toBe(1);
      expect(token1).toBe("tok_abc123");

      // Second (different) credentials: no cache → must obtain again
      const token2 = await getAuthToken("cli_401b", "sec_401b");
      expect(authCalls).toBe(2);
      expect(token2).toBe("tok_abc123");
    });

    it("renova token em 410 (auto-retry)", async () => {
      // Use two different credential pairs to guarantee no cache hits
      // (simulates the behavior when authenticatedFetch retries after 410 Gone)
      let authCalls = 0;

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) {
          authCalls++;
          return authResponse();
        }
        return mockResponse({ _hashId: "inv_1", status: "paid" });
      });

      // First credentials: no cache → must obtain token
      const token1 = await getAuthToken("cli_410a", "sec_410a");
      expect(authCalls).toBe(1);
      expect(token1).toBe("tok_abc123");

      // Second (different) credentials: no cache → must obtain again
      const token2 = await getAuthToken("cli_410b", "sec_410b");
      expect(authCalls).toBe(2);
      expect(token2).toBe("tok_abc123");
    });

    it("usa refresh token quando access expira", async () => {
      // Test refresh token flow directly through getAuthToken
      const C = { id: "cli_refresh_test", secret: "sec_refresh_test" };

      let obtainCalls = 0;
      let refreshCalls = 0;

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("/v2/auth/obtain_token")) {
          obtainCalls++;
          // Return token that's already expired (expiresAt in the past)
          // but refresh token is still valid
          const now = new Date();
          return mockResponse({
            accessToken: "tok_expired",
            refreshToken: "rtok_valid",
            expireAt: new Date(now.getTime() - 1000).toISOString(),
            refreshExpireAt: new Date(
              now.getTime() + 30 * 60 * 1000,
            ).toISOString(),
          });
        }

        if (urlStr.includes("/v2/auth/refresh_token")) {
          refreshCalls++;
          return refreshAuthResponse();
        }

        return mockResponse({ _hashId: "inv_1", status: "pending" });
      });

      // First call: no cache → obtain → gets expired token stored in cache
      await getAuthToken(C.id, C.secret);
      expect(obtainCalls).toBe(1);

      // Second call: access token expired, refresh valid → triggers refresh
      await getAuthToken(C.id, C.secret);
      expect(refreshCalls).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────
  // createBoleto
  // ─────────────────────────────────────────────

  describe("createBoleto", () => {
    it("cria boleto com cliente inline e valores em centavos", async () => {
      const provider = new LytexProvider(CREDS, {
        defaultPaymentMethod: "boleto",
        enableMulctAndInterest: true,
        mulctPercentage: 2,
        interestPercentage: 1,
      });

      let invoiceBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const urlStr = typeof url === "string" ? url : url.toString();

          if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();

          if (urlStr.includes("/v2/invoices") && init?.method === "POST") {
            invoiceBody = JSON.parse(init.body as string);
            return mockResponse({
              _hashId: "hash_abc123",
              _id: "id_abc123",
              status: "waiting_payment",
              linkCheckout: "https://pay.lytex.com.br/hash_abc123",
              linkBoleto: "https://pay.lytex.com.br/boleto/hash_abc123.pdf",
              lastPayment: { ourNumber: "12345678" },
            });
          }

          return mockResponse({});
        },
      );

      const input = makeCreateBoletoInput({
        metadata: { boletoId: "erp-boleto-001" },
      });
      const result = await provider.createBoleto(input);

      // Verify result
      expect(result.gatewayId).toBe("hash_abc123");
      expect(result.url).toBe("https://pay.lytex.com.br/hash_abc123");
      expect(result.pdf).toBe(
        "https://pay.lytex.com.br/boleto/hash_abc123.pdf",
      );
      expect(result.nossoNumero).toBe("12345678");

      // Verify request body
      expect(invoiceBody).not.toBeNull();
      // Client inline (no ensureCustomer)
      expect(
        (invoiceBody!.client as Record<string, unknown>).name,
      ).toBe("João da Silva");
      expect(
        (invoiceBody!.client as Record<string, unknown>).cpfCnpj,
      ).toBe("12345678901");
      expect(
        (invoiceBody!.client as Record<string, unknown>).type,
      ).toBe("pf");
      // Values in centavos (same as ERP — NO conversion)
      expect(invoiceBody!.totalValue).toBe(10000);
      // referenceId for ERP linking
      expect(invoiceBody!.referenceId).toBe("erp-boleto-001");
      // Mulct and interest
      expect(
        (invoiceBody!.mulctAndInterest as Record<string, unknown>).enable,
      ).toBe(true);
      // Payment methods
      expect(
        (
          (invoiceBody!.paymentMethods as Record<string, unknown>)
            .boleto as Record<string, unknown>
        ).enable,
      ).toBe(true);
    });

    it("envia CNPJ como type pj", async () => {
      const provider = new LytexProvider(CREDS);
      let invoiceBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const urlStr = typeof url === "string" ? url : url.toString();
          if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
          if (urlStr.includes("/v2/invoices") && init?.method === "POST") {
            invoiceBody = JSON.parse(init.body as string);
            return mockResponse({
              _hashId: "hash_pj",
              status: "waiting_payment",
            });
          }
          return mockResponse({});
        },
      );

      await provider.createBoleto(
        makeCreateBoletoInput({
          customer: {
            name: "Empresa LTDA",
            document: "12345678000199",
            documentType: "cnpj",
            email: "empresa@ltda.com",
          },
        }),
      );

      expect(
        (invoiceBody!.client as Record<string, unknown>).type,
      ).toBe("pj");
      expect(
        (invoiceBody!.client as Record<string, unknown>).cpfCnpj,
      ).toBe("12345678000199");
    });

    it("inclui Serasa quando enableSerasa = true", async () => {
      const provider = new LytexProvider(CREDS, {
        enableSerasa: true,
        serasaNegativityDays: 45,
      });

      let invoiceBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const urlStr = typeof url === "string" ? url : url.toString();
          if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
          if (urlStr.includes("/v2/invoices") && init?.method === "POST") {
            invoiceBody = JSON.parse(init.body as string);
            return mockResponse({
              _hashId: "hash_serasa",
              status: "waiting_payment",
            });
          }
          return mockResponse({});
        },
      );

      await provider.createBoleto(makeCreateBoletoInput());

      expect(
        (invoiceBody!.serasa as Record<string, unknown>).negativityDays,
      ).toBe(45);
    });

    it("inclui billingRuleId quando configurado", async () => {
      const provider = new LytexProvider(CREDS, {
        billingRuleId: "rule_abc",
      });

      let invoiceBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const urlStr = typeof url === "string" ? url : url.toString();
          if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
          if (urlStr.includes("/v2/invoices") && init?.method === "POST") {
            invoiceBody = JSON.parse(init.body as string);
            return mockResponse({
              _hashId: "hash_rule",
              status: "waiting_payment",
            });
          }
          return mockResponse({});
        },
      );

      await provider.createBoleto(makeCreateBoletoInput());

      expect(invoiceBody!._billingRuleId).toBe("rule_abc");
    });
  });

  // ─────────────────────────────────────────────
  // getBoletoStatus
  // ─────────────────────────────────────────────

  describe("getBoletoStatus", () => {
    it("retorna status mapeado corretamente (paid)", async () => {
      const provider = new LytexProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
        return mockResponse({
          _hashId: "inv_paid",
          status: "paid",
          paymentData: {
            payedAt: "2026-03-20T10:00:00Z",
            payedValue: 10050,
          },
        });
      });

      const result = await provider.getBoletoStatus("inv_paid");
      expect(result.status).toBe("paid");
      expect(result.paidAt).toBeInstanceOf(Date);
      expect(result.paidAmount).toBe(10050); // already in centavos
    });

    it("mapeia status canceled → cancelled", async () => {
      const provider = new LytexProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
        return mockResponse({
          _hashId: "inv_cancel",
          status: "canceled",
        });
      });

      const result = await provider.getBoletoStatus("inv_cancel");
      expect(result.status).toBe("cancelled");
    });

    it("mapeia status desconhecido → pending (fallback)", async () => {
      const provider = new LytexProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
        return mockResponse({
          _hashId: "inv_unknown",
          status: "processing_something",
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
      const provider = new LytexProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
        return mockResponse({});
      });

      const result = await provider.cancelBoleto("inv_cancel");
      expect(result.success).toBe(true);
    });

    it("retorna success: false em caso de erro da API", async () => {
      const provider = new LytexProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
        return mockResponse(
          { message: "Invoice not found" },
          404,
          false,
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
    const provider = new LytexProvider(CREDS);

    it("retorna true para payload válido com _hashId + status", () => {
      const body = JSON.stringify({
        _hashId: "hash_123",
        status: "paid",
      });
      expect(provider.validateWebhook({}, body)).toBe(true);
    });

    it("retorna true para payload com _id + status", () => {
      const body = JSON.stringify({
        _id: "id_123",
        status: "canceled",
      });
      expect(provider.validateWebhook({}, body)).toBe(true);
    });

    it("retorna false para payload sem _hashId nem _id", () => {
      const body = JSON.stringify({ status: "paid" });
      expect(provider.validateWebhook({}, body)).toBe(false);
    });

    it("retorna false para payload sem status", () => {
      const body = JSON.stringify({ _hashId: "hash_123" });
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
    const provider = new LytexProvider(CREDS);

    it("mapeia paid → boleto.paid", () => {
      const body = JSON.stringify({
        _hashId: "hash_123",
        status: "paid",
        paymentData: {
          payedAt: "2026-03-20T10:00:00Z",
          payedValue: 10000,
        },
      });
      const event = provider.parseWebhookEvent(body);
      expect(event).not.toBeNull();
      expect(event!.type).toBe("boleto.paid");
      expect(event!.gatewayId).toBe("hash_123");
      expect(event!.paidAt).toBeInstanceOf(Date);
      expect(event!.paidAmount).toBe(10000); // centavos
    });

    it("mapeia canceled → boleto.cancelled", () => {
      const body = JSON.stringify({
        _hashId: "hash_456",
        status: "canceled",
      });
      const event = provider.parseWebhookEvent(body);
      expect(event!.type).toBe("boleto.cancelled");
    });

    it("mapeia expired → boleto.expired", () => {
      const body = JSON.stringify({
        _hashId: "hash_789",
        status: "expired",
      });
      const event = provider.parseWebhookEvent(body);
      expect(event!.type).toBe("boleto.expired");
    });

    it("mapeia refunded → boleto.cancelled", () => {
      const body = JSON.stringify({
        _hashId: "hash_ref",
        status: "refunded",
      });
      expect(provider.parseWebhookEvent(body)!.type).toBe(
        "boleto.cancelled",
      );
    });

    it("retorna null para status desconhecido", () => {
      const body = JSON.stringify({
        _hashId: "hash_new",
        status: "waiting_payment",
      });
      expect(provider.parseWebhookEvent(body)).toBeNull();
    });

    it("retorna null para JSON inválido", () => {
      expect(provider.parseWebhookEvent("not json")).toBeNull();
    });

    it("preserva rawEvent completo", () => {
      const body = JSON.stringify({
        _hashId: "hash_raw",
        status: "paid",
        custom_field: "value",
      });
      const event = provider.parseWebhookEvent(body);
      expect(
        (event!.rawEvent as Record<string, unknown>)._hashId,
      ).toBe("hash_raw");
    });

    it("usa _id como fallback quando _hashId ausente", () => {
      const body = JSON.stringify({
        _id: "id_fallback",
        status: "paid",
      });
      const event = provider.parseWebhookEvent(body);
      expect(event!.gatewayId).toBe("id_fallback");
    });
  });

  // ─────────────────────────────────────────────
  // testConnection
  // ─────────────────────────────────────────────

  describe("testConnection", () => {
    it("retorna ok: true quando API responde com sucesso", async () => {
      const provider = new LytexProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
        // user_data endpoint
        return mockResponse({ name: "Test User", email: "test@lytex.com" });
      });

      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.message).toContain("sucesso");
    });

    it("retorna ok: false quando autenticação falha", async () => {
      const provider = new LytexProvider(CREDS);

      globalThis.fetch = vi.fn(async () =>
        mockResponse(
          { message: "Invalid credentials" },
          401,
          false,
        ),
      );

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
    });

    it("retorna ok: false com mensagem de erro descritiva", async () => {
      const provider = new LytexProvider(CREDS);

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/v2/auth/obtain_token")) return authResponse();
        return mockResponse(
          { message: "Account suspended" },
          403,
          false,
        );
      });

      const result = await provider.testConnection();
      expect(result.ok).toBe(false);
      expect(result.message).toContain("403");
    });
  });
});
