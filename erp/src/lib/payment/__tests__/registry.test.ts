import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// PROVIDER_REGISTRY é avaliado em module-load time.
// Usamos vi.resetModules() + vi.stubEnv() + dynamic import para testar cada env.

describe("PRODUCTION_PROVIDER_REGISTRY (estático)", () => {
  it("contém pagarme e pinbank", async () => {
    const { PRODUCTION_PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PRODUCTION_PROVIDER_REGISTRY).toHaveProperty("pagarme");
    expect(PRODUCTION_PROVIDER_REGISTRY).toHaveProperty("pinbank");
  });

  it("não inclui mock", async () => {
    const { PRODUCTION_PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PRODUCTION_PROVIDER_REGISTRY).not.toHaveProperty("mock");
  });

  it("cada provider tem id, name e configSchema", async () => {
    const { PRODUCTION_PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    for (const [key, def] of Object.entries(PRODUCTION_PROVIDER_REGISTRY)) {
      expect(def.id).toBe(key);
      expect(typeof def.name).toBe("string");
      expect(Array.isArray(def.configSchema)).toBe(true);
    }
  });
});

describe("DEV_PROVIDER_REGISTRY (estático)", () => {
  it("contém mock além dos providers de produção", async () => {
    const { DEV_PROVIDER_REGISTRY, PRODUCTION_PROVIDER_REGISTRY } = await import(
      "@/lib/payment/registry"
    );
    expect(DEV_PROVIDER_REGISTRY).toHaveProperty("mock");
    for (const key of Object.keys(PRODUCTION_PROVIDER_REGISTRY)) {
      expect(DEV_PROVIDER_REGISTRY).toHaveProperty(key);
    }
  });

  it("mock provider tem configSchema e settingsSchema vazios", async () => {
    const { DEV_PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(DEV_PROVIDER_REGISTRY.mock.configSchema).toEqual([]);
    expect(DEV_PROVIDER_REGISTRY.mock.settingsSchema).toEqual([]);
  });
});

describe("PROVIDER_REGISTRY em produção (NODE_ENV=production)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("não inclui mock", async () => {
    const { PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PROVIDER_REGISTRY).not.toHaveProperty("mock");
  });

  it("inclui pagarme e pinbank", async () => {
    const { PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PROVIDER_REGISTRY).toHaveProperty("pagarme");
    expect(PROVIDER_REGISTRY).toHaveProperty("pinbank");
  });

  it("é idêntico a PRODUCTION_PROVIDER_REGISTRY", async () => {
    const { PROVIDER_REGISTRY, PRODUCTION_PROVIDER_REGISTRY } = await import(
      "@/lib/payment/registry"
    );
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual(
      Object.keys(PRODUCTION_PROVIDER_REGISTRY).sort()
    );
  });
});

describe("PROVIDER_REGISTRY em desenvolvimento (NODE_ENV=development)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("inclui mock", async () => {
    const { PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PROVIDER_REGISTRY).toHaveProperty("mock");
  });

  it("inclui pagarme e pinbank", async () => {
    const { PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PROVIDER_REGISTRY).toHaveProperty("pagarme");
    expect(PROVIDER_REGISTRY).toHaveProperty("pinbank");
  });

  it("é idêntico a DEV_PROVIDER_REGISTRY", async () => {
    const { PROVIDER_REGISTRY, DEV_PROVIDER_REGISTRY } = await import(
      "@/lib/payment/registry"
    );
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual(
      Object.keys(DEV_PROVIDER_REGISTRY).sort()
    );
  });
});

describe("PROVIDER_REGISTRY em teste (NODE_ENV=test)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("inclui mock (ambiente não-produção)", async () => {
    const { PROVIDER_REGISTRY } = await import("@/lib/payment/registry");
    expect(PROVIDER_REGISTRY).toHaveProperty("mock");
  });
});
