import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockAggregate = vi.fn();
const mockGroupBy = vi.fn();

vi.mock("@/lib/ai/rate-limiter", () => ({
  logInteraction: vi.fn(),
}));

vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  return {
    logger: _log,
    createChildLogger: vi.fn(() => _log),
    sanitizeParams: vi.fn((obj: Record<string, unknown>) => obj),
    truncateForLog: vi.fn((v: unknown) => v),
    classifyError: vi.fn(() => "INTERNAL_ERROR"),
    classifyErrorByStatus: vi.fn(() => "INTERNAL_ERROR"),
    ErrorCode: {},
    MAX_LOG_ARG_SIZE: 10240,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageLog: {
      create: (...args: unknown[]) => mockCreate(...args),
      aggregate: (...args: unknown[]) => mockAggregate(...args),
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("cost-tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── logUsage ───────────────────────────────────────────────────────────────

  describe("logUsage", () => {
    it("creates a usage log with correct cost calculations", async () => {
      mockCreate.mockResolvedValue({});

      const { logUsage } = await import("@/lib/ai/cost-tracker");

      await logUsage({
        aiConfigId: "config-1",
        companyId: "company-1",
        provider: "openai",
        model: "gpt-4o",            // $2.5 / 1M input, $10 / 1M output
        channel: "WHATSAPP",
        inputTokens: 1_000_000,     // exactly 1M input tokens → $2.5
        outputTokens: 1_000_000,    // exactly 1M output tokens → $10
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      const data = mockCreate.mock.calls[0][0].data;

      expect(data.companyId).toBe("company-1");
      expect(data.provider).toBe("openai");
      expect(data.model).toBe("gpt-4o");
      expect(data.inputTokens).toBe(1_000_000);
      expect(data.outputTokens).toBe(1_000_000);

      // costUsd = 2.5 + 10.0 = 12.5 — check it's stored correctly
      expect(parseFloat(data.costUsd.toString())).toBeCloseTo(12.5, 4);
      // costBrl = 12.5 * 5.8 = 72.5
      expect(parseFloat(data.costBrl.toString())).toBeCloseTo(72.5, 2);
    });

    it("uses FALLBACK_PRICING for unknown models", async () => {
      mockCreate.mockResolvedValue({});

      const { logUsage } = await import("@/lib/ai/cost-tracker");

      await logUsage({
        aiConfigId: "config-1",
        companyId: "company-1",
        provider: "openai",
        model: "unknown-model-xyz",  // falls back to {input: 1.0, output: 3.0}
        channel: "WHATSAPP",
        inputTokens: 1_000_000,      // $1.0
        outputTokens: 1_000_000,     // $3.0 → total $4.0 USD
      });

      const data = mockCreate.mock.calls[0][0].data;
      expect(parseFloat(data.costUsd.toString())).toBeCloseTo(4.0, 4);
    });

    it("passes ticketId when provided", async () => {
      mockCreate.mockResolvedValue({});
      const { logUsage } = await import("@/lib/ai/cost-tracker");

      await logUsage({
        aiConfigId: "cfg",
        companyId: "co",
        provider: "openai",
        model: "gpt-4o-mini",
        channel: "EMAIL",
        inputTokens: 100,
        outputTokens: 50,
        ticketId: "ticket-abc",
      });

      expect(mockCreate.mock.calls[0][0].data.ticketId).toBe("ticket-abc");
    });
  });

  // ── getTodaySpend ──────────────────────────────────────────────────────────

  describe("getTodaySpend", () => {
    it("returns the summed costBrl for today", async () => {
      mockAggregate.mockResolvedValue({ _sum: { costBrl: 42.75 } });

      const { getTodaySpend } = await import("@/lib/ai/cost-tracker");
      const result = await getTodaySpend("company-1");

      expect(result).toBeCloseTo(42.75);
      expect(mockAggregate).toHaveBeenCalledOnce();
    });

    it("returns 0 when no logs exist (null sum)", async () => {
      mockAggregate.mockResolvedValue({ _sum: { costBrl: null } });

      const { getTodaySpend } = await import("@/lib/ai/cost-tracker");
      const result = await getTodaySpend("company-empty");

      expect(result).toBe(0);
    });

    it("queries from BRT midnight (createdAt gte filter exists)", async () => {
      mockAggregate.mockResolvedValue({ _sum: { costBrl: 0 } });

      const { getTodaySpend } = await import("@/lib/ai/cost-tracker");
      await getTodaySpend("company-1");

      const whereClause = mockAggregate.mock.calls[0][0].where;
      expect(whereClause.createdAt).toBeDefined();
      expect(whereClause.createdAt.gte).toBeInstanceOf(Date);

      // The start-of-day should be within the last 24 hours
      const gte: Date = whereClause.createdAt.gte;
      const ageMs = Date.now() - gte.getTime();
      expect(ageMs).toBeGreaterThanOrEqual(0);
      expect(ageMs).toBeLessThan(86_400_000); // less than 24h ago
    });

    it("filters by companyId", async () => {
      mockAggregate.mockResolvedValue({ _sum: { costBrl: 10 } });

      const { getTodaySpend } = await import("@/lib/ai/cost-tracker");
      await getTodaySpend("specific-company");

      const whereClause = mockAggregate.mock.calls[0][0].where;
      expect(whereClause.companyId).toBe("specific-company");
    });

    it("excludes simulation records from the spend total (isSimulation: false)", async () => {
      mockAggregate.mockResolvedValue({ _sum: { costBrl: 20 } });

      const { getTodaySpend } = await import("@/lib/ai/cost-tracker");
      await getTodaySpend("company-sim");

      const whereClause = mockAggregate.mock.calls[0][0].where;
      expect(whereClause.isSimulation).toBe(false);
    });
  });

  // ── getUsageSummary ────────────────────────────────────────────────────────

  describe("getUsageSummary", () => {
    beforeEach(() => {
      mockAggregate.mockResolvedValue({
        _sum: {
          inputTokens: 5000,
          outputTokens: 3000,
          costBrl: 8.5,
          costUsd: 1.46,
        },
      });
      mockGroupBy.mockResolvedValue([]);
    });

    it("returns totals mapped from prisma aggregate", async () => {
      const { getUsageSummary } = await import("@/lib/ai/cost-tracker");
      const summary = await getUsageSummary("company-1", 7);

      expect(summary.totalInputTokens).toBe(5000);
      expect(summary.totalOutputTokens).toBe(3000);
      expect(summary.totalCostBrl).toBeCloseTo(8.5);
      expect(summary.totalCostUsd).toBeCloseTo(1.46);
    });

    it("returns empty arrays when no channel/model data", async () => {
      const { getUsageSummary } = await import("@/lib/ai/cost-tracker");
      const summary = await getUsageSummary("company-1", 7);

      expect(summary.byChannel).toEqual([]);
      expect(summary.byModel).toEqual([]);
    });

    it("excludes simulation records from summary (isSimulation: false in where)", async () => {
      const { getUsageSummary } = await import("@/lib/ai/cost-tracker");
      await getUsageSummary("company-1", 7);
      const aggregateCall = mockAggregate.mock.calls[0][0] as Record<string, unknown>;
      const whereClause = aggregateCall.where as Record<string, unknown>;
      expect(whereClause.isSimulation).toBe(false);
    });

    it("maps channel breakdown correctly", async () => {
      mockGroupBy
        .mockResolvedValueOnce([
          // first call: by channel
          {
            channel: "WHATSAPP",
            _sum: { inputTokens: 3000, outputTokens: 2000, costBrl: 5.0 },
          },
        ])
        .mockResolvedValueOnce([]); // second call: by model

      const { getUsageSummary } = await import("@/lib/ai/cost-tracker");
      const summary = await getUsageSummary("company-1", 7);

      expect(summary.byChannel).toHaveLength(1);
      expect(summary.byChannel[0].channel).toBe("WHATSAPP");
      expect(summary.byChannel[0].totalTokens).toBe(5000);
      expect(summary.byChannel[0].costBrl).toBeCloseTo(5.0);
    });
  });
});
