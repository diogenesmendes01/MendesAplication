import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findUnique: vi.fn(), update: vi.fn() },
    aiUsageLog: { count: vi.fn() },
    aiRateLimitEvent: { create: vi.fn() },
    ticketMessage: { create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => Array.isArray(ops) ? Promise.all(ops) : undefined),
  },
}));
vi.mock("@/lib/ai/resolve-config", () => ({ resolveAiConfig: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from "@/lib/prisma";
import { resolveAiConfig } from "@/lib/ai/resolve-config";
import { checkRateLimit, logInteraction, getTicketBudgetUsage } from "@/lib/ai/rate-limiter";

const TID = "ticket-123", CID = "company-456";
const baseTkt: any = { aiEnabled: true, aiDisabledReason: null, aiTotalCostBrl: 0, lastAiResponseAt: null };
const baseCfg: any = { maxAiInteractionsPerTicketPerHour: 5, aiCooldownSeconds: 30, maxBudgetPerTicketBrl: 2.0, rateLimitAction: "pause" };
beforeEach(() => vi.clearAllMocks());

describe("checkRateLimit", () => {
  it("allows when no limits", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(baseTkt);
    vi.mocked(resolveAiConfig).mockResolvedValue({ ...baseCfg, maxBudgetPerTicketBrl: null, maxAiInteractionsPerTicketPerHour: 0, aiCooldownSeconds: 0 });
    expect((await checkRateLimit(TID, CID)).allowed).toBe(true);
  });
  it("blocks when AI disabled", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ ...baseTkt, aiEnabled: false });
    expect((await checkRateLimit(TID, CID)).allowed).toBe(false);
  });
  it("blocks when not found", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(null);
    const r = await checkRateLimit(TID, CID);
    expect(r.allowed).toBe(false); expect(r.reason).toBe("ai_disabled");
  });
  it("blocks on budget exceeded", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ ...baseTkt, aiTotalCostBrl: 2.5 });
    vi.mocked(resolveAiConfig).mockResolvedValue(baseCfg);
    const r = await checkRateLimit(TID, CID);
    expect(r.allowed).toBe(false); expect(r.reason).toBe("budget_exceeded");
  });
  it("returns delay on cooldown", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ ...baseTkt, lastAiResponseAt: new Date(Date.now() - 15000) });
    vi.mocked(resolveAiConfig).mockResolvedValue({ ...baseCfg, maxBudgetPerTicketBrl: null });
    const r = await checkRateLimit(TID, CID);
    expect(r.allowed).toBe(true); expect(r.delayMs).toBeGreaterThan(0);
  });
  it("allows after cooldown", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ ...baseTkt, lastAiResponseAt: new Date(Date.now() - 40000) });
    vi.mocked(resolveAiConfig).mockResolvedValue({ ...baseCfg, maxBudgetPerTicketBrl: null, maxAiInteractionsPerTicketPerHour: 0 });
    expect((await checkRateLimit(TID, CID)).allowed).toBe(true);
  });
  it("blocks on interaction limit", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(baseTkt);
    vi.mocked(resolveAiConfig).mockResolvedValue({ ...baseCfg, maxBudgetPerTicketBrl: null, aiCooldownSeconds: 0 });
    vi.mocked(prisma.aiUsageLog.count).mockResolvedValue(5);
    const r = await checkRateLimit(TID, CID);
    expect(r.allowed).toBe(false); expect(r.reason).toBe("interaction_limit"); expect(r.retryAfterSeconds).toBe(3600);
  });
  it("allows below limit", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(baseTkt);
    vi.mocked(resolveAiConfig).mockResolvedValue({ ...baseCfg, maxBudgetPerTicketBrl: null, aiCooldownSeconds: 0 });
    vi.mocked(prisma.aiUsageLog.count).mockResolvedValue(3);
    expect((await checkRateLimit(TID, CID)).allowed).toBe(true);
  });
  it("allows when no config", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(baseTkt);
    vi.mocked(resolveAiConfig).mockResolvedValue(null);
    expect((await checkRateLimit(TID, CID)).allowed).toBe(true);
  });
});

describe("logInteraction", () => {
  it("updates ticket", async () => {
    vi.mocked(prisma.ticket.update).mockResolvedValue({} as any);
    await logInteraction(TID, 0.05);
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: TID }, data: { aiTotalCostBrl: { increment: 0.05 }, lastAiResponseAt: expect.any(Date) },
    });
  });
  it("handles errors gracefully", async () => {
    vi.mocked(prisma.ticket.update).mockRejectedValue(new Error("fail"));
    await expect(logInteraction(TID, 0.05)).resolves.toBeUndefined();
  });
});

describe("getTicketBudgetUsage", () => {
  it("returns usage with limit", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ aiTotalCostBrl: 1.5 } as any);
    vi.mocked(resolveAiConfig).mockResolvedValue({ maxBudgetPerTicketBrl: 2.0 } as any);
    expect(await getTicketBudgetUsage(TID, CID)).toEqual({ usedBrl: 1.5, limitBrl: 2.0, remainingBrl: 0.5 });
  });
  it("returns null when no limit", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ aiTotalCostBrl: 1.5 } as any);
    vi.mocked(resolveAiConfig).mockResolvedValue({ maxBudgetPerTicketBrl: null } as any);
    expect((await getTicketBudgetUsage(TID, CID)).limitBrl).toBeNull();
  });
  it("returns zero remaining when exceeded", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ aiTotalCostBrl: 3.0 } as any);
    vi.mocked(resolveAiConfig).mockResolvedValue({ maxBudgetPerTicketBrl: 2.0 } as any);
    expect((await getTicketBudgetUsage(TID, CID)).remainingBrl).toBe(0);
  });
});
