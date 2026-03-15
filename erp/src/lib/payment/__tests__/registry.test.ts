import { describe, it, expect } from "vitest";
import {
  PRODUCTION_PROVIDER_REGISTRY,
  DEV_PROVIDER_REGISTRY,
  PROVIDER_REGISTRY,
} from "@/lib/payment/registry";
import { PRODUCTION_PROVIDER_TYPES } from "@/lib/payment/constants";

describe("PRODUCTION_PROVIDER_REGISTRY", () => {
  it("contém pagarme e pinbank", () => {
    expect(PRODUCTION_PROVIDER_REGISTRY).toHaveProperty("pagarme");
    expect(PRODUCTION_PROVIDER_REGISTRY).toHaveProperty("pinbank");
  });

  it("NÃO contém mock", () => {
    expect(PRODUCTION_PROVIDER_REGISTRY).not.toHaveProperty("mock");
  });

  it("cada entrada tem id, name, configSchema e settingsSchema", () => {
    for (const key of Object.keys(PRODUCTION_PROVIDER_REGISTRY)) {
      const entry = PRODUCTION_PROVIDER_REGISTRY[key];
      expect(entry).toHaveProperty("id", key);
      expect(entry).toHaveProperty("name");
      expect(Array.isArray(entry.configSchema)).toBe(true);
      expect(Array.isArray(entry.settingsSchema)).toBe(true);
    }
  });

  it("chaves do registry estão alinhadas com PRODUCTION_PROVIDER_TYPES", () => {
    const registryKeys = Object.keys(PRODUCTION_PROVIDER_REGISTRY).sort();
    const typesKeys = [...PRODUCTION_PROVIDER_TYPES].sort();
    expect(registryKeys).toEqual(typesKeys);
  });
});

describe("DEV_PROVIDER_REGISTRY", () => {
  it("contém todos os providers de produção", () => {
    for (const key of Object.keys(PRODUCTION_PROVIDER_REGISTRY)) {
      expect(DEV_PROVIDER_REGISTRY).toHaveProperty(key);
    }
  });

  it("contém mock", () => {
    expect(DEV_PROVIDER_REGISTRY).toHaveProperty("mock");
  });

  it("entrada mock tem id='mock' e schemas vazios", () => {
    const mock = DEV_PROVIDER_REGISTRY["mock"];
    expect(mock.id).toBe("mock");
    expect(mock.configSchema).toEqual([]);
    expect(mock.settingsSchema).toEqual([]);
  });

  it("tem mais providers que PRODUCTION_PROVIDER_REGISTRY", () => {
    expect(Object.keys(DEV_PROVIDER_REGISTRY).length).toBeGreaterThan(
      Object.keys(PRODUCTION_PROVIDER_REGISTRY).length
    );
  });
});

describe("PROVIDER_REGISTRY (condicional por NODE_ENV)", () => {
  it("em ambiente não-produção (test), inclui mock", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(PROVIDER_REGISTRY).toHaveProperty("mock");
  });

  it("sempre contém os providers de produção", () => {
    for (const key of Object.keys(PRODUCTION_PROVIDER_REGISTRY)) {
      expect(PROVIDER_REGISTRY).toHaveProperty(key);
    }
  });

  it("PRODUCTION_PROVIDER_REGISTRY nunca inclui mock, independente do ambiente", () => {
    expect(PRODUCTION_PROVIDER_REGISTRY).not.toHaveProperty("mock");
  });
});
