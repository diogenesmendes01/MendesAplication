import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Atenção: PROVIDER_TYPES é avaliado em module-load time.
// Usamos vi.resetModules() + vi.stubEnv() + dynamic import para simular cada env.

describe("PRODUCTION_PROVIDER_TYPES e DEV_PROVIDER_TYPES (estáticos)", () => {
  it("PRODUCTION_PROVIDER_TYPES contém pagarme e pinbank", async () => {
    const { PRODUCTION_PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pagarme");
    expect(PRODUCTION_PROVIDER_TYPES).toContain("pinbank");
  });

  it("PRODUCTION_PROVIDER_TYPES não inclui mock", async () => {
    const { PRODUCTION_PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(PRODUCTION_PROVIDER_TYPES).not.toContain("mock");
  });

  it("DEV_PROVIDER_TYPES contém pagarme, pinbank e mock", async () => {
    const { DEV_PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(DEV_PROVIDER_TYPES).toContain("pagarme");
    expect(DEV_PROVIDER_TYPES).toContain("pinbank");
    expect(DEV_PROVIDER_TYPES).toContain("mock");
  });

  it("DEV_PROVIDER_TYPES é superconjunto de PRODUCTION_PROVIDER_TYPES", async () => {
    const { PRODUCTION_PROVIDER_TYPES, DEV_PROVIDER_TYPES } = await import(
      "@/lib/payment/constants"
    );
    for (const p of PRODUCTION_PROVIDER_TYPES) {
      expect(DEV_PROVIDER_TYPES).toContain(p);
    }
  });
});

describe("PROVIDER_TYPES em produção (NODE_ENV=production)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("não inclui mock", async () => {
    const { PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(PROVIDER_TYPES).not.toContain("mock");
  });

  it("inclui pagarme e pinbank", async () => {
    const { PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(PROVIDER_TYPES).toContain("pagarme");
    expect(PROVIDER_TYPES).toContain("pinbank");
  });

  it("é idêntico a PRODUCTION_PROVIDER_TYPES", async () => {
    const { PROVIDER_TYPES, PRODUCTION_PROVIDER_TYPES } = await import(
      "@/lib/payment/constants"
    );
    expect([...PROVIDER_TYPES].sort()).toEqual([...PRODUCTION_PROVIDER_TYPES].sort());
  });
});

describe("PROVIDER_TYPES em desenvolvimento (NODE_ENV=development)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("inclui mock", async () => {
    const { PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(PROVIDER_TYPES).toContain("mock");
  });

  it("inclui pagarme e pinbank", async () => {
    const { PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(PROVIDER_TYPES).toContain("pagarme");
    expect(PROVIDER_TYPES).toContain("pinbank");
  });

  it("é idêntico a DEV_PROVIDER_TYPES", async () => {
    const { PROVIDER_TYPES, DEV_PROVIDER_TYPES } = await import(
      "@/lib/payment/constants"
    );
    expect([...PROVIDER_TYPES].sort()).toEqual([...DEV_PROVIDER_TYPES].sort());
  });
});

describe("PROVIDER_TYPES em teste (NODE_ENV=test)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("inclui mock (ambiente não-produção)", async () => {
    const { PROVIDER_TYPES } = await import("@/lib/payment/constants");
    expect(PROVIDER_TYPES).toContain("mock");
  });
});
