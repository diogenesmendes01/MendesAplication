import { describe, it, expect, vi, afterEach } from "vitest";
import { isProviderType, PROVIDER_TYPES, MOCK_PROVIDER } from "@/lib/payment/types";

// isProviderType() lê process.env.NODE_ENV em call-time (não em module-load time),
// por isso vi.stubEnv() é suficiente — não precisamos de vi.resetModules() aqui.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isProviderType()", () => {
  it("retorna true para cada provider de produção", () => {
    for (const p of PROVIDER_TYPES) {
      expect(isProviderType(p)).toBe(true);
    }
  });

  it("retorna true para o provider de mock (fallback interno)", () => {
    expect(isProviderType(MOCK_PROVIDER)).toBe(true);
  });

  it("retorna false para string vazia", () => {
    expect(isProviderType("")).toBe(false);
  });

  it("retorna false para valor desconhecido", () => {
    expect(isProviderType("stripe")).toBe(false);
    expect(isProviderType("paypal")).toBe(false);
    expect(isProviderType("PAGARME")).toBe(false); // case-sensitive
  });

  it("retorna false para valor injetado simulando registro legado de DB", () => {
    expect(isProviderType("legacy_provider")).toBe(false);
    expect(isProviderType("test_bank")).toBe(false);
  });

  it("retorna false para null/undefined convertidos em string", () => {
    expect(isProviderType("null")).toBe(false);
    expect(isProviderType("undefined")).toBe(false);
  });
});

describe("isProviderType() — env-aware: NODE_ENV=production", () => {
  it("aceita provider de produção (pagarme) → true", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProviderType("pagarme")).toBe(true);
  });

  it("rejeita 'mock' em produção → false (guard de segurança)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProviderType("mock")).toBe(false);
  });

  it("rejeita valor inválido em produção → false", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProviderType("invalid")).toBe(false);
  });
});

describe("isProviderType() — env-aware: NODE_ENV=development", () => {
  it("aceita 'mock' em desenvolvimento → true", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isProviderType("mock")).toBe(true);
  });

  it("aceita provider de produção (pagarme) em desenvolvimento → true", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isProviderType("pagarme")).toBe(true);
  });
});

describe("isProviderType() — env-aware: NODE_ENV=test", () => {
  it("aceita 'mock' em ambiente de test → true", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(isProviderType("mock")).toBe(true);
  });
});

describe("PROVIDER_TYPES (array canônico de produção)", () => {
  it("não inclui mock (mock não deve ser persistido no banco em produção)", () => {
    expect(PROVIDER_TYPES).not.toContain("mock");
  });

  it("inclui pagarme e pinbank", () => {
    expect(PROVIDER_TYPES).toContain("pagarme");
    expect(PROVIDER_TYPES).toContain("pinbank");
  });
});

describe("MOCK_PROVIDER", () => {
  it("é a string 'mock'", () => {
    expect(MOCK_PROVIDER).toBe("mock");
  });
});
