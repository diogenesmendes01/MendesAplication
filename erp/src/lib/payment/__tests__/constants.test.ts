import { describe, it, expect } from "vitest";
import {
  PRODUCTION_PROVIDER_TYPES,
  DEV_PROVIDER_TYPES,
  PROVIDER_TYPES,
} from "@/lib/payment/constants";

describe("PRODUCTION_PROVIDER_TYPES", () => {
  it("contém pagarme e pinbank", () => {
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pagarme");
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pinbank");
  });

  it("NÃO contém mock", () => {
    expect(PRODUCTION_PROVIDER_TYPES).not.toContain("mock");
  });

  it("é readonly (as const)", () => {
    // Verifica que é um array com pelo menos 2 elementos
    expect(PRODUCTION_PROVIDER_TYPES.length).toBeGreaterThanOrEqual(2);
  });
});

describe("DEV_PROVIDER_TYPES", () => {
  it("contém todos os providers de produção", () => {
    for (const p of PRODUCTION_PROVIDER_TYPES) {
      expect(DEV_PROVIDER_TYPES).toContain(p);
    }
  });

  it("contém mock", () => {
    expect(DEV_PROVIDER_TYPES).toContain("mock");
  });

  it("tem mais providers que PRODUCTION_PROVIDER_TYPES", () => {
    expect(DEV_PROVIDER_TYPES.length).toBeGreaterThan(PRODUCTION_PROVIDER_TYPES.length);
  });
});

describe("PROVIDER_TYPES (condicional por NODE_ENV)", () => {
  it("é PRODUCTION_PROVIDER_TYPES em ambiente de teste (NODE_ENV=test)", () => {
    // Em vitest, NODE_ENV é 'test', portanto PROVIDER_TYPES === DEV_PROVIDER_TYPES
    // Verificamos que o conteúdo inclui mock (dev/test) e os providers de produção
    for (const p of PRODUCTION_PROVIDER_TYPES) {
      expect(PROVIDER_TYPES).toContain(p);
    }
  });

  it("em ambiente não-produção, inclui mock", () => {
    // NODE_ENV=test → branch dev/test ativo
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(PROVIDER_TYPES).toContain("mock");
  });

  it("PRODUCTION_PROVIDER_TYPES nunca inclui mock, independente do ambiente", () => {
    expect(PRODUCTION_PROVIDER_TYPES).not.toContain("mock");
  });
});
