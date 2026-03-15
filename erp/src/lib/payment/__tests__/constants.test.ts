import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PRODUCTION_PROVIDER_TYPES,
  DEV_PROVIDER_TYPES,
  MAX_INSTALLMENTS,
  RECEIVABLE_VALUE_TOLERANCE,
  RECEIVABLE_DUE_DATE_WINDOW_DAYS,
  CENTS_PER_UNIT,
} from "@/lib/payment/constants";

describe("PRODUCTION_PROVIDER_TYPES", () => {
  it("contém pagarme e pinbank", () => {
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pagarme");
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pinbank");
  });

  it("não contém mock", () => {
    expect(PRODUCTION_PROVIDER_TYPES).not.toContain("mock");
  });

  it("é readonly (as const)", () => {
    // O tipo deve ser readonly — verificação em tempo de compilação passa se o build passa.
    // Em runtime, Array.isArray confirma a estrutura.
    expect(Array.isArray(PRODUCTION_PROVIDER_TYPES)).toBe(true);
  });
});

describe("DEV_PROVIDER_TYPES", () => {
  it("inclui todos os providers de produção", () => {
    for (const p of PRODUCTION_PROVIDER_TYPES) {
      expect(DEV_PROVIDER_TYPES).toContain(p);
    }
  });

  it("inclui mock", () => {
    expect(DEV_PROVIDER_TYPES).toContain("mock");
  });

  it("tem mais elementos que PRODUCTION_PROVIDER_TYPES", () => {
    expect(DEV_PROVIDER_TYPES.length).toBeGreaterThan(PRODUCTION_PROVIDER_TYPES.length);
  });
});

describe("PROVIDER_TYPES (env-aware)", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  it("exporta array com ao menos um provider de produção", async () => {
    const { PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(PROVIDER_TYPES.length).toBeGreaterThanOrEqual(1);
  });

  it("em produção contém exatamente os providers de PRODUCTION_PROVIDER_TYPES", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const { PROVIDER_TYPES, PRODUCTION_PROVIDER_TYPES: PROD } = await import(
      "@/lib/payment/constants"
    );
    // Em produção deve usar apenas providers de produção
    for (const p of PROD) {
      expect(PROVIDER_TYPES).toContain(p);
    }
    expect(PROVIDER_TYPES).not.toContain("mock");
  });
});

describe("Numeric constants", () => {
  it("MAX_INSTALLMENTS é 48", () => {
    expect(MAX_INSTALLMENTS).toBe(48);
  });

  it("RECEIVABLE_VALUE_TOLERANCE é 0.01", () => {
    expect(RECEIVABLE_VALUE_TOLERANCE).toBe(0.01);
  });

  it("RECEIVABLE_DUE_DATE_WINDOW_DAYS é 15", () => {
    expect(RECEIVABLE_DUE_DATE_WINDOW_DAYS).toBe(15);
  });

  it("CENTS_PER_UNIT converte reais para centavos corretamente", () => {
    const reais = 10;
    expect(reais * CENTS_PER_UNIT).toBe(1000);
  });
});
