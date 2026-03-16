import { describe, it, expect } from "vitest";
import { isProviderType, MOCK_PROVIDER } from "@/lib/payment/types";
import {
  PROVIDER_TYPES,
  PRODUCTION_PROVIDER_TYPES,
} from "@/lib/payment/constants";

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

describe("PROVIDER_TYPES (from constants.ts — environment-aware)", () => {
  it("inclui pagarme e pinbank em qualquer ambiente", () => {
    expect(PROVIDER_TYPES).toContain("pagarme");
    expect(PROVIDER_TYPES).toContain("pinbank");
  });

  it("PRODUCTION_PROVIDER_TYPES não inclui mock", () => {
    expect(PRODUCTION_PROVIDER_TYPES).not.toContain("mock");
  });

  it("PRODUCTION_PROVIDER_TYPES inclui pagarme e pinbank", () => {
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pagarme");
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pinbank");
  });

  // In test environment, PROVIDER_TYPES should include mock (DEV_PROVIDER_TYPES)
  it("em ambiente de teste, PROVIDER_TYPES inclui mock", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(PROVIDER_TYPES).toContain("mock");
  });
});

describe("MOCK_PROVIDER", () => {
  it("é a string 'mock'", () => {
    expect(MOCK_PROVIDER).toBe("mock");
  });
});
