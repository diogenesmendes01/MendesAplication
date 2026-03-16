import { describe, it, expect } from "vitest";
import { isProviderType, MOCK_PROVIDER } from "@/lib/payment/types";
// PROVIDER_TYPES env-aware é exportado pelo barrel "@/lib/payment" (via constants.ts).
// Não importar de "@/lib/payment/types" — esse módulo não exporta mais PROVIDER_TYPES
// para evitar dual-source-of-truth (ver QA WARN D1).
import { PRODUCTION_PROVIDER_TYPES } from "@/lib/payment/constants";

describe("isProviderType()", () => {
  it("retorna true para cada provider de produção", () => {
    for (const p of PRODUCTION_PROVIDER_TYPES) {
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

describe("PRODUCTION_PROVIDER_TYPES (array canônico de produção — de constants.ts)", () => {
  it("não inclui mock (mock não deve ser persistido no banco em produção)", () => {
    expect(PRODUCTION_PROVIDER_TYPES).not.toContain("mock");
  });

  it("inclui pagarme e pinbank", () => {
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pagarme");
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pinbank");
  });
});

describe("MOCK_PROVIDER", () => {
  it("é a string 'mock'", () => {
    expect(MOCK_PROVIDER).toBe("mock");
  });
});
