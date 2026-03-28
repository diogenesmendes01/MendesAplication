/**
 * Tests for AI Audit Trail module.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockPrisma = {
  aiConfig: { findFirst: vi.fn(), findMany: vi.fn() },
  aiAuditTrail: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { recordAuditTrail, getAuditTrail, exportAuditTrailCSV, exportAuditTrailJSON, cleanupAuditTrails } = await import("@/lib/ai/audit-trail");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseEntry = {
  ticketId: "ticket-1",
  companyId: "company-1",
  channel: "WHATSAPP" as const,
  iteration: 1,
  input: "Preciso da segunda via do boleto",
  toolCalls: [
    { tool: "GET_CLIENT_INFO", args: {}, result: "Cliente: ABC Corp", durationMs: 45 },
    { tool: "RESPOND", args: { message: "Encontrei boletos" }, result: "Mensagem enviada", durationMs: 3 },
  ],
  output: "Encontrei 2 boletos pendentes",
  decision: "respond",
  confidence: 0.85,
  inputTokens: 1200,
  outputTokens: 350,
  costBrl: 0.04,
  durationMs: 2350,
  provider: "openai",
  model: "gpt-4o-mini",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("recordAuditTrail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates audit entry when enabled", async () => {
    mockPrisma.aiConfig.findFirst.mockResolvedValueOnce({ auditTrailEnabled: true });
    mockPrisma.aiAuditTrail.create.mockResolvedValueOnce({ id: "audit-1" });
    const result = await recordAuditTrail(baseEntry);
    expect(result).toBe("audit-1");
    expect(mockPrisma.aiAuditTrail.create).toHaveBeenCalledTimes(1);
    const createArgs = mockPrisma.aiAuditTrail.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArgs.data.ticketId).toBe("ticket-1");
    expect(createArgs.data.decision).toBe("respond");
  });

  it("skips recording when disabled", async () => {
    mockPrisma.aiConfig.findFirst.mockResolvedValueOnce({ auditTrailEnabled: false });
    const result = await recordAuditTrail(baseEntry);
    expect(result).toBeNull();
    expect(mockPrisma.aiAuditTrail.create).not.toHaveBeenCalled();
  });

  it("falls back to global config if channel-specific not found", async () => {
    mockPrisma.aiConfig.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ auditTrailEnabled: true });
    mockPrisma.aiAuditTrail.create.mockResolvedValueOnce({ id: "audit-2" });
    const result = await recordAuditTrail(baseEntry);
    expect(result).toBe("audit-2");
    expect(mockPrisma.aiConfig.findFirst).toHaveBeenCalledTimes(2);
  });

  it("truncates tool call results to 500 chars", async () => {
    mockPrisma.aiConfig.findFirst.mockResolvedValueOnce({ auditTrailEnabled: true });
    mockPrisma.aiAuditTrail.create.mockResolvedValueOnce({ id: "audit-3" });
    const entry = { ...baseEntry, toolCalls: [{ tool: "SEARCH", args: {}, result: "x".repeat(1000), durationMs: 100 }] };
    await recordAuditTrail(entry);
    const createArgs = mockPrisma.aiAuditTrail.create.mock.calls[0][0] as { data: { toolCalls: Array<{ result: string }> } };
    expect(createArgs.data.toolCalls[0].result.length).toBe(500);
  });

  it("returns null on error without throwing", async () => {
    mockPrisma.aiConfig.findFirst.mockRejectedValueOnce(new Error("DB error"));
    const result = await recordAuditTrail(baseEntry);
    expect(result).toBeNull();
  });
});

describe("getAuditTrail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries non-archived entries for ticket", async () => {
    const entries = [{ id: "a1", ticketId: "t1", iteration: 1, createdAt: new Date() }];
    mockPrisma.aiAuditTrail.findMany.mockResolvedValueOnce(entries);
    const result = await getAuditTrail("t1", "c1");
    expect(result).toEqual(entries);
    expect(mockPrisma.aiAuditTrail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ticketId: "t1", companyId: "c1", isArchived: false }, orderBy: { createdAt: "asc" } }),
    );
  });
});

describe("exportAuditTrailCSV", () => {
  beforeEach(() => vi.clearAllMocks());

  it("produces valid CSV with headers", async () => {
    mockPrisma.aiAuditTrail.findMany.mockResolvedValueOnce([{
      id: "a1", createdAt: new Date("2026-03-27T14:32:15.000Z"), iteration: 1, input: "Test",
      reasoning: "Test reasoning", toolCalls: [{ tool: "GET_HISTORY", args: {}, result: "ok", durationMs: 10 }],
      output: "Output", decision: "respond", confidence: 0.9, inputTokens: 100, outputTokens: 50,
      costBrl: 0.001234, durationMs: 500, provider: "openai", model: "gpt-4o-mini",
    }]);
    const csv = await exportAuditTrailCSV("t1", "c1");
    const lines = csv.split("\n");
    expect(lines[0]).toContain("timestamp");
    expect(lines[0]).toContain("reasoning");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("2026-03-27");
  });

  it("escapes CSV values with commas", async () => {
    mockPrisma.aiAuditTrail.findMany.mockResolvedValueOnce([{
      id: "a2", createdAt: new Date(), iteration: 1, input: 'Input with "quotes" and, commas',
      reasoning: null, toolCalls: [], output: "out", decision: "respond", confidence: 0.5,
      inputTokens: 50, outputTokens: 25, costBrl: 0.001, durationMs: 200, provider: "openai", model: "gpt-4o-mini",
    }]);
    const csv = await exportAuditTrailCSV("t1", "c1");
    expect(csv).toContain('"Input with ""quotes"" and, commas"');
  });
});

describe("exportAuditTrailJSON", () => {
  beforeEach(() => vi.clearAllMocks());

  it("produces valid JSON array", async () => {
    mockPrisma.aiAuditTrail.findMany.mockResolvedValueOnce([{ id: "a1", iteration: 1 }]);
    const json = await exportAuditTrailJSON("t1", "c1");
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("a1");
  });
});

describe("cleanupAuditTrails", () => {
  beforeEach(() => vi.clearAllMocks());

  it("archives old entries and hard-deletes very old ones", async () => {
    mockPrisma.aiConfig.findMany.mockResolvedValueOnce([{ companyId: "c1", auditRetentionDays: 90 }]);
    mockPrisma.aiAuditTrail.updateMany.mockResolvedValueOnce({ count: 5 });
    mockPrisma.aiAuditTrail.deleteMany.mockResolvedValueOnce({ count: 2 });
    const result = await cleanupAuditTrails();
    expect(result.archived).toBe(5);
    expect(result.deleted).toBe(2);
    expect(mockPrisma.aiAuditTrail.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isArchived: true } }));
  });

  it("does nothing when no configs have retention", async () => {
    mockPrisma.aiConfig.findMany.mockResolvedValueOnce([]);
    const result = await cleanupAuditTrails();
    expect(result.archived).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("handles multiple companies", async () => {
    mockPrisma.aiConfig.findMany.mockResolvedValueOnce([
      { companyId: "c1", auditRetentionDays: 30 },
      { companyId: "c2", auditRetentionDays: 90 },
    ]);
    mockPrisma.aiAuditTrail.updateMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 7 });
    mockPrisma.aiAuditTrail.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const result = await cleanupAuditTrails();
    expect(result.archived).toBe(10);
    expect(result.deleted).toBe(1);
    expect(mockPrisma.aiAuditTrail.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.aiAuditTrail.deleteMany).toHaveBeenCalledTimes(2);
  });
});
