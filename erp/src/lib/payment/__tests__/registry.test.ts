import { describe, it, expect, afterEach, vi } from "vitest";
import {
  PRODUCTION_PROVIDER_REGISTRY,
  DEV_PROVIDER_REGISTRY,
} from "@/lib/payment/registry";

describe("PRODUCTION_PROVIDER_REGISTRY", () => {
  it("contém pagarme", () => {
    expect(PRODUCTION_PROVIDER_REGISTRY).toHaveProperty("pagarme");
  });

  it("contém pinbank", () => {
    expect(PRODUCTION_PROVIDER_REGISTRY).toHaveProperty("pinbank");
  });

  it("não contém mock", () => {
    expect(PRODUCTION_PROVIDER_REGISTRY).not.toHaveProperty("mock");
  });

  it("pagarme tem id e name preenchidos", () => {
    expect(PRODUCTION_PROVIDER_REGISTRY.pagarme.id).toBe("pagarme");
    expect(PRODUCTION_PROVIDER_REGISTRY.pagarme.name).toBeTruthy();
  });

  it("pinbank tem id e name preenchidos", () => {
    expect(PRODUCTION_PROVIDER_REGISTRY.pinbank.id).toBe("pinbank");
    expect(PRODUCTION_PROVIDER_REGISTRY.pinbank.name).toBeTruthy();
  });

  it("cada provider tem configSchema como array", () => {
    for (const provider of Object.values(PRODUCTION_PROVIDER_REGISTRY)) {
      expect(Array.isArray(provider.configSchema)).toBe(true);
      expect(Array.isArray(provider.settingsSchema)).toBe(true);
    }
  });

  it("pagarme exige apiKey em configSchema", () => {
    const keys = PRODUCTION_PROVIDER_REGISTRY.pagarme.configSchema.map((f) => f.key);
    expect(keys).toContain("apiKey");
  });

  it("pagarme.configSchema apiKey é required e do tipo password", () => {
    const apiKeyField = PRODUCTION_PROVIDER_REGISTRY.pagarme.configSchema.find(
      (f) => f.key === "apiKey"
    );
    expect(apiKeyField).toBeDefined();
    expect(apiKeyField!.required).toBe(true);
    expect(apiKeyField!.type).toBe("password");
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

  it("mock tem configSchema vazio (sem campos obrigatórios)", () => {
    expect(DEV_PROVIDER_REGISTRY.mock.configSchema).toHaveLength(0);
    expect(DEV_PROVIDER_REGISTRY.mock.settingsSchema).toHaveLength(0);
  });

  it("tem mais providers que PRODUCTION_PROVIDER_REGISTRY", () => {
    expect(Object.keys(DEV_PROVIDER_REGISTRY).length).toBeGreaterThan(
      Object.keys(PRODUCTION_PROVIDER_REGISTRY).length
    );
  });
});

describe("PROVIDER_REGISTRY (env-aware)", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  it("em produção não expõe mock", async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const { PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PROVIDER_REGISTRY).not.toHaveProperty("mock");
  });

  it("fora de produção expõe mock", async () => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const { PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PROVIDER_REGISTRY).toHaveProperty("mock");
  });
});
