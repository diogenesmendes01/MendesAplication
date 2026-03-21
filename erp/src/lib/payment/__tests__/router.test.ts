import { describe, it, expect, vi, beforeEach } from "vitest";
import { matchesRule, buildReason } from "@/lib/payment/router";
import { makeRoutingRule, makePaymentProvider } from "./helpers";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentRoutingRule: {
      findMany: vi.fn(),
    },
    paymentProvider: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

const mockedPrisma = vi.mocked(prisma, true);

describe("matchesRule", () => {
  it("match quando rule.clientType é null (match any)", () => {
    const rule = makeRoutingRule({ clientType: null });
    expect(matchesRule(rule as never, { clientType: "PF", value: 100 })).toBe(true);
    expect(matchesRule(rule as never, { clientType: "PJ", value: 100 })).toBe(true);
  });

  it("match quando clientType é igual", () => {
    const rule = makeRoutingRule({ clientType: "PF" });
    expect(matchesRule(rule as never, { clientType: "PF", value: 100 })).toBe(true);
  });

  it("não match quando clientType difere", () => {
    const rule = makeRoutingRule({ clientType: "PJ" });
    expect(matchesRule(rule as never, { clientType: "PF", value: 100 })).toBe(false);
  });

  it("match quando valor está dentro do range", () => {
    const rule = makeRoutingRule({ minValue: 100, maxValue: 500 });
    expect(matchesRule(rule as never, { clientType: "PF", value: 250 })).toBe(true);
  });

  it("match nos limites exatos do range", () => {
    const rule = makeRoutingRule({ minValue: 100, maxValue: 500 });
    expect(matchesRule(rule as never, { clientType: "PF", value: 100 })).toBe(true);
    expect(matchesRule(rule as never, { clientType: "PF", value: 500 })).toBe(true);
  });

  it("não match quando valor abaixo de minValue", () => {
    const rule = makeRoutingRule({ minValue: 100 });
    expect(matchesRule(rule as never, { clientType: "PF", value: 50 })).toBe(false);
  });

  it("não match quando valor acima de maxValue", () => {
    const rule = makeRoutingRule({ maxValue: 500 });
    expect(matchesRule(rule as never, { clientType: "PF", value: 600 })).toBe(false);
  });

  it("match quando minValue/maxValue são null (sem limites)", () => {
    const rule = makeRoutingRule({ minValue: null, maxValue: null });
    expect(matchesRule(rule as never, { clientType: "PF", value: 999999 })).toBe(true);
  });

  it("match quando todas as tags presentes", () => {
    const rule = makeRoutingRule({ tags: ["vip", "recorrente"] });
    expect(
      matchesRule(rule as never, {
        clientType: "PF",
        value: 100,
        tags: ["vip", "recorrente", "extra"],
      }),
    ).toBe(true);
  });

  it("não match quando tag faltando", () => {
    const rule = makeRoutingRule({ tags: ["vip", "recorrente"] });
    expect(
      matchesRule(rule as never, {
        clientType: "PF",
        value: 100,
        tags: ["vip"],
      }),
    ).toBe(false);
  });

  it("match quando rule.tags é vazio (sem exigência de tags)", () => {
    const rule = makeRoutingRule({ tags: [] });
    expect(matchesRule(rule as never, { clientType: "PF", value: 100 })).toBe(true);
  });

  it("não match quando context.tags é undefined e rule exige tags", () => {
    const rule = makeRoutingRule({ tags: ["vip"] });
    expect(matchesRule(rule as never, { clientType: "PF", value: 100 })).toBe(false);
  });
});

describe("buildReason", () => {
  it("gera razão com clientType", () => {
    const rule = makeRoutingRule({ clientType: "PJ", priority: 1, tags: [] });
    const reason = buildReason(rule as never);
    expect(reason).toContain("cliente PJ");
    expect(reason).toContain("prioridade 1");
  });

  it("gera razão com range de valor", () => {
    const rule = makeRoutingRule({ minValue: 100, maxValue: 500, priority: 2, tags: [] });
    const reason = buildReason(rule as never);
    expect(reason).toContain("valor");
    expect(reason).toContain("100.00");
    expect(reason).toContain("500.00");
  });

  it("gera razão com tags", () => {
    const rule = makeRoutingRule({ tags: ["vip", "premium"], priority: 3 });
    const reason = buildReason(rule as never);
    expect(reason).toContain("vip");
    expect(reason).toContain("premium");
  });

  it("gera razão genérica quando sem filtros", () => {
    const rule = makeRoutingRule({
      clientType: null,
      minValue: null,
      maxValue: null,
      tags: [],
      priority: 5,
    });
    const reason = buildReason(rule as never);
    expect(reason).toContain("match geral");
  });
});

describe("resolveProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna provider da primeira regra que casa", async () => {
    const { resolveProvider } = await import("@/lib/payment/router");
    const provider = makePaymentProvider({ id: "prov-match", name: "Matched" });
    const rule = makeRoutingRule({ clientType: "PF", provider });

    mockedPrisma.paymentRoutingRule.findMany.mockResolvedValue([rule] as never);

    const result = await resolveProvider("company-001", { clientType: "PF", value: 100 });
    expect(result.id).toBe("prov-match");
  });

  it("retorna default provider quando nenhuma regra casa", async () => {
    const { resolveProvider } = await import("@/lib/payment/router");
    const rule = makeRoutingRule({ clientType: "PJ" });
    const defaultProvider = makePaymentProvider({ id: "prov-default", isDefault: true });

    mockedPrisma.paymentRoutingRule.findMany.mockResolvedValue([rule] as never);
    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(defaultProvider as never);

    const result = await resolveProvider("company-001", { clientType: "PF", value: 100 });
    expect(result.id).toBe("prov-default");
  });

  it("throw quando sem regra e sem default", async () => {
    const { resolveProvider } = await import("@/lib/payment/router");

    mockedPrisma.paymentRoutingRule.findMany.mockResolvedValue([]);
    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(null);

    await expect(
      resolveProvider("company-001", { clientType: "PF", value: 100 }),
    ).rejects.toThrow("Nenhuma regra de roteamento casou");
  });
});

describe("previewRouting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna preview quando regra casa", async () => {
    const { previewRouting } = await import("@/lib/payment/router");
    const provider = makePaymentProvider({ id: "prov-1", name: "Pagar.me" });
    const rule = makeRoutingRule({ clientType: null, provider, priority: 1, tags: [] });

    mockedPrisma.paymentRoutingRule.findMany.mockResolvedValue([rule] as never);

    const result = await previewRouting("company-001", { clientType: "PF", value: 100 });
    expect(result).not.toBeNull();
    expect(result!.providerId).toBe("prov-1");
    expect(result!.providerName).toBe("Pagar.me");
  });

  it("retorna null quando sem regra e sem default", async () => {
    const { previewRouting } = await import("@/lib/payment/router");

    mockedPrisma.paymentRoutingRule.findMany.mockResolvedValue([]);
    mockedPrisma.paymentProvider.findFirst.mockResolvedValue(null);

    const result = await previewRouting("company-001", { clientType: "PF", value: 100 });
    expect(result).toBeNull();
  });
});
