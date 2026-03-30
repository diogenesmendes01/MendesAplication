import { vi, describe, it, expect, beforeEach, beforeAll } from "vitest";

const mockPrisma = {
  aiConfig: { findFirst: vi.fn(), findMany: vi.fn() },
  aiAuditTrail: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  return {
    logger: _log,
    createChildLogger: vi.fn(() => _log),
    sanitizeParams: vi.fn((obj: Record<string, unknown>) => obj),
    truncateForLog: vi.fn((v: unknown) => v),
    classifyError: vi.fn(() => "INTERNAL_ERROR"),
    classifyErrorByStatus: vi.fn(() => "INTERNAL_ERROR"),
    ErrorCode: {
      AUTH_FAILED: "AUTH_FAILED",
      VALIDATION_ERROR: "VALIDATION_ERROR",
      NOT_FOUND: "NOT_FOUND",
      PERMISSION_DENIED: "PERMISSION_DENIED",
      EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
      DATABASE_ERROR: "DATABASE_ERROR",
      ENCRYPTION_ERROR: "ENCRYPTION_ERROR",
      RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
      INTERNAL_ERROR: "INTERNAL_ERROR",
      AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
    },
    MAX_LOG_ARG_SIZE: 10240,
  };
});

let recordAuditTrail: Awaited<typeof import("@/lib/ai/audit-trail")>["recordAuditTrail"];
let getAuditTrail: Awaited<typeof import("@/lib/ai/audit-trail")>["getAuditTrail"];
let exportAuditTrailCSV: Awaited<typeof import("@/lib/ai/audit-trail")>["exportAuditTrailCSV"];
let exportAuditTrailJSON: Awaited<typeof import("@/lib/ai/audit-trail")>["exportAuditTrailJSON"];
let cleanupAuditTrails: Awaited<typeof import("@/lib/ai/audit-trail")>["cleanupAuditTrails"];

beforeAll(async () => {
  const mod = await import("@/lib/ai/audit-trail");
  recordAuditTrail = mod.recordAuditTrail;
  getAuditTrail = mod.getAuditTrail;
  exportAuditTrailCSV = mod.exportAuditTrailCSV;
  exportAuditTrailJSON = mod.exportAuditTrailJSON;
  cleanupAuditTrails = mod.cleanupAuditTrails;
});

const baseEntry = {
  ticketId: "ticket-1", companyId: "company-1", channel: "WHATSAPP" as const, iteration: 1,
  input: "Preciso da segunda via do boleto",
  toolCalls: [{ tool: "GET_CLIENT_INFO", args: {}, result: "Cliente: ABC Corp", durationMs: 45 }, { tool: "RESPOND", args: { message: "Encontrei boletos" }, result: "Enviado", durationMs: 3 }],
  output: "Encontrei 2 boletos pendentes", decision: "respond", confidence: 0.85,
  inputTokens: 1200, outputTokens: 350, costBrl: 0.04, durationMs: 2350, provider: "openai", model: "gpt-4o-mini",
};

describe("recordAuditTrail", () => {
  beforeEach(() => vi.clearAllMocks());
  it("creates audit entry when enabled", async () => {
    mockPrisma.aiConfig.findFirst.mockResolvedValueOnce({ auditTrailEnabled: true });
    mockPrisma.aiAuditTrail.create.mockResolvedValueOnce({ id: "audit-1" });
    expect(await recordAuditTrail(baseEntry)).toBe("audit-1");
    expect(mockPrisma.aiAuditTrail.create).toHaveBeenCalledTimes(1);
  });
  it("skips recording when disabled", async () => {
    mockPrisma.aiConfig.findFirst.mockResolvedValueOnce({ auditTrailEnabled: false });
    expect(await recordAuditTrail(baseEntry)).toBeNull();
    expect(mockPrisma.aiAuditTrail.create).not.toHaveBeenCalled();
  });
  it("falls back to global config", async () => {
    mockPrisma.aiConfig.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ auditTrailEnabled: true });
    mockPrisma.aiAuditTrail.create.mockResolvedValueOnce({ id: "audit-2" });
    expect(await recordAuditTrail(baseEntry)).toBe("audit-2");
    expect(mockPrisma.aiConfig.findFirst).toHaveBeenCalledTimes(2);
  });
  it("truncates tool results to 500 chars", async () => {
    mockPrisma.aiConfig.findFirst.mockResolvedValueOnce({ auditTrailEnabled: true });
    mockPrisma.aiAuditTrail.create.mockResolvedValueOnce({ id: "audit-3" });
    await recordAuditTrail({ ...baseEntry, toolCalls: [{ tool: "S", args: {}, result: "x".repeat(1000), durationMs: 100 }] });
    const args = mockPrisma.aiAuditTrail.create.mock.calls[0][0] as { data: { toolCalls: Array<{ result: string }> } };
    expect(args.data.toolCalls[0].result.length).toBe(500);
  });
  it("returns null on error without throwing", async () => {
    mockPrisma.aiConfig.findFirst.mockRejectedValueOnce(new Error("DB"));
    expect(await recordAuditTrail(baseEntry)).toBeNull();
  });
});

describe("getAuditTrail", () => {
  beforeEach(() => vi.clearAllMocks());
  it("queries non-archived entries", async () => {
    mockPrisma.aiAuditTrail.findMany.mockResolvedValueOnce([{ id: "a1" }]);
    const r = await getAuditTrail("t1", "c1");
    expect(r).toEqual([{ id: "a1" }]);
    expect(mockPrisma.aiAuditTrail.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ticketId: "t1", companyId: "c1", isArchived: false } }));
  });
});

describe("exportAuditTrailCSV", () => {
  beforeEach(() => vi.clearAllMocks());
  it("produces valid CSV", async () => {
    mockPrisma.aiAuditTrail.findMany.mockResolvedValueOnce([{
      id: "a1", createdAt: new Date("2026-03-27T14:32:15Z"), iteration: 1, input: "Test",
      reasoning: "R", toolCalls: [{ tool: "T", args: {}, result: "ok", durationMs: 10 }],
      output: "Out", decision: "respond", confidence: 0.9, inputTokens: 100, outputTokens: 50, costBrl: 0.001, durationMs: 500, provider: "openai", model: "gpt-4o-mini",
    }]);
    const csv = await exportAuditTrailCSV("t1", "c1");
    expect(csv.split("\n")[0]).toContain("timestamp");
    expect(csv.split("\n").length).toBe(2);
  });
  it("escapes commas and quotes", async () => {
    mockPrisma.aiAuditTrail.findMany.mockResolvedValueOnce([{
      id: "a2", createdAt: new Date(), iteration: 1, input: 'A "B", C', reasoning: null,
      toolCalls: [], output: "o", decision: "respond", confidence: 0.5, inputTokens: 50, outputTokens: 25, costBrl: 0.001, durationMs: 200, provider: "openai", model: "gpt-4o-mini",
    }]);
    expect(await exportAuditTrailCSV("t1", "c1")).toContain('"A ""B"", C"');
  });
});

describe("exportAuditTrailJSON", () => {
  beforeEach(() => vi.clearAllMocks());
  it("produces valid JSON", async () => {
    mockPrisma.aiAuditTrail.findMany.mockResolvedValueOnce([{ id: "a1" }]);
    expect(JSON.parse(await exportAuditTrailJSON("t1", "c1"))[0].id).toBe("a1");
  });
});

describe("cleanupAuditTrails", () => {
  beforeEach(() => vi.clearAllMocks());
  it("archives and hard-deletes", async () => {
    mockPrisma.aiConfig.findMany.mockResolvedValueOnce([{ companyId: "c1", auditRetentionDays: 90 }]);
    mockPrisma.aiAuditTrail.updateMany.mockResolvedValueOnce({ count: 5 });
    mockPrisma.aiAuditTrail.deleteMany.mockResolvedValueOnce({ count: 2 });
    expect(await cleanupAuditTrails()).toEqual({ archived: 5, deleted: 2 });
  });
  it("no-op when no configs", async () => {
    mockPrisma.aiConfig.findMany.mockResolvedValueOnce([]);
    expect(await cleanupAuditTrails()).toEqual({ archived: 0, deleted: 0 });
  });
  it("handles multiple companies", async () => {
    mockPrisma.aiConfig.findMany.mockResolvedValueOnce([{ companyId: "c1", auditRetentionDays: 30 }, { companyId: "c2", auditRetentionDays: 90 }]);
    mockPrisma.aiAuditTrail.updateMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 7 });
    mockPrisma.aiAuditTrail.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await cleanupAuditTrails()).toEqual({ archived: 10, deleted: 1 });
  });
});
