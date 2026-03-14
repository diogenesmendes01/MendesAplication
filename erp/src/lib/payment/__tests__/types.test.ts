import { describe, it, expect } from "vitest";
import { isProviderType, PROVIDER_TYPES, MOCK_PROVIDER } from "@/lib/payment/types";

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
