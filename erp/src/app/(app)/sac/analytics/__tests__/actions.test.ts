import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAggregate = vi.fn();
const mockGroupBy = vi.fn();
const mockCount = vi.fn();
const mockFindMany = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/session", () => ({ getSession: vi.fn().mockResolvedValue({ userId: "test-user", companyId: "test-company" }) }));

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
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageLog: {
      aggregate: (...args: unknown[]) => mockAggregate(...args),
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
    aiSuggestion: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
      count: (...args: unknown[]) => mockCount(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    ticket: {
      count: (...args: unknown[]) => mockCount(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

vi.mock("@/lib/rbac", () => ({
  requireCompanyAccess: vi.fn().mockResolvedValue({ userId: "user-1", role: "ADMIN" }),
}));

const COMPANY_ID = "company-1";
const PERIOD = { from: new Date("2026-03-01"), to: new Date("2026-03-28") };

describe("AI Observability Actions", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("getAiKpis", () => {
    it("returns aggregated KPI data", async () => {
      mockAggregate.mockResolvedValue({
        _sum: { costBrl: 142.5, inputTokens: 500000, outputTokens: 200000 },
        _count: 847,
      });
      mockCount.mockResolvedValueOnce(65).mockResolvedValueOnce(18);

      const { getAiKpis } = await import("../actions");
      const result = await getAiKpis(COMPANY_ID, PERIOD);

      expect(result.totalCostBrl).toBe(142.5);
      expect(result.totalCalls).toBe(847);
      expect(result.totalTokens).toBe(700000);
      expect(result.aiResolvedTickets).toBe(65);
      expect(result.humanResolvedTickets).toBe(18);
      expect(result.aiResolutionRate).toBeCloseTo(65 / 83, 2);
    });

    it("handles zero data gracefully", async () => {
      mockAggregate.mockResolvedValue({
        _sum: { costBrl: null, inputTokens: null, outputTokens: null },
        _count: 0,
      });
      mockCount.mockResolvedValue(0);

      const { getAiKpis } = await import("../actions");
      const result = await getAiKpis(COMPANY_ID, PERIOD);

      expect(result.totalCostBrl).toBe(0);
      expect(result.totalCalls).toBe(0);
      expect(result.avgCostPerCall).toBe(0);
      expect(result.aiResolutionRate).toBe(0);
    });
  });

  describe("getCostByDay", () => {
    it("returns daily cost breakdown", async () => {
      mockQueryRaw.mockResolvedValue([
        { day: new Date("2026-03-01"), cost_brl: 5.25, calls: BigInt(42) },
        { day: new Date("2026-03-02"), cost_brl: 3.1, calls: BigInt(28) },
      ]);

      const { getCostByDay } = await import("../actions");
      const result = await getCostByDay(COMPANY_ID, PERIOD);

      expect(result).toHaveLength(2);
      expect(result[0].day).toBe("2026-03-01");
      expect(result[0].costBrl).toBe(5.25);
      expect(result[0].calls).toBe(42);
    });
  });

  describe("getCostByChannel", () => {
    it("groups costs by channel", async () => {
      mockGroupBy.mockResolvedValue([
        { channel: "WHATSAPP", _sum: { costBrl: 85.2 }, _count: 500 },
        { channel: "EMAIL", _sum: { costBrl: 38.1 }, _count: 250 },
        { channel: "RECLAMEAQUI", _sum: { costBrl: 19.2 }, _count: 97 },
      ]);

      const { getCostByChannel } = await import("../actions");
      const result = await getCostByChannel(COMPANY_ID, PERIOD);

      expect(result).toHaveLength(3);
      expect(result[0].channel).toBe("WHATSAPP");
      expect(result[0].costBrl).toBe(85.2);
    });
  });

  describe("getTopTicketsByCost", () => {
    it("returns top N tickets by cost", async () => {
      mockGroupBy.mockResolvedValue([
        { ticketId: "ticket-1", _sum: { costBrl: 1.85, inputTokens: 50000, outputTokens: 20000 } },
        { ticketId: "ticket-2", _sum: { costBrl: 1.2, inputTokens: 30000, outputTokens: 15000 } },
      ]);

      const { getTopTicketsByCost } = await import("../actions");
      const result = await getTopTicketsByCost(COMPANY_ID, PERIOD, 5);

      expect(result).toHaveLength(2);
      expect(result[0].ticketId).toBe("ticket-1");
      expect(result[0].costBrl).toBe(1.85);
    });
  });

  describe("getSuggestionBreakdown", () => {
    it("computes approval/rejection rates", async () => {
      mockGroupBy.mockResolvedValue([
        { status: "APPROVED", _count: 45 },
        { status: "REJECTED", _count: 10 },
        { status: "EDITED", _count: 15 },
        { status: "EXPIRED", _count: 5 },
        { status: "PENDING", _count: 3 },
      ]);

      const { getSuggestionBreakdown } = await import("../actions");
      const result = await getSuggestionBreakdown(COMPANY_ID, PERIOD);

      expect(result.total).toBe(78);
      expect(result.approved).toBe(45);
      expect(result.approvalRate).toBeCloseTo(60 / 78, 2);
      expect(result.rejectionRate).toBeCloseTo(10 / 78, 2);
    });
  });

  describe("getConfidenceCalibration", () => {
    it("returns calibration data for each confidence bucket", async () => {
      mockCount
        .mockResolvedValueOnce(45).mockResolvedValueOnce(42)
        .mockResolvedValueOnce(68).mockResolvedValueOnce(55)
        .mockResolvedValueOnce(52).mockResolvedValueOnce(34)
        .mockResolvedValueOnce(28).mockResolvedValueOnce(15)
        .mockResolvedValueOnce(12).mockResolvedValueOnce(4);

      const { getConfidenceCalibration } = await import("../actions");
      const result = await getConfidenceCalibration(COMPANY_ID, PERIOD);

      expect(result).toHaveLength(5);
      expect(result[0].label).toBe("90-100%");
      expect(result[0].rate).toBeCloseTo(42 / 45, 2);
      expect(result[4].label).toBe("< 60%");
      expect(result[4].rate).toBeCloseTo(4 / 12, 2);
    });

    it("handles empty buckets", async () => {
      mockCount.mockResolvedValue(0);

      const { getConfidenceCalibration } = await import("../actions");
      const result = await getConfidenceCalibration(COMPANY_ID, PERIOD);

      expect(result).toHaveLength(5);
      for (const bucket of result) {
        expect(bucket.total).toBe(0);
        expect(bucket.rate).toBe(0);
      }
    });
  });

  describe("getEscalationRate", () => {
    it("computes escalation rate", async () => {
      mockCount.mockResolvedValueOnce(100).mockResolvedValueOnce(12);

      const { getEscalationRate } = await import("../actions");
      const result = await getEscalationRate(COMPANY_ID, PERIOD);

      expect(result.totalAiTickets).toBe(100);
      expect(result.escalatedCount).toBe(12);
      expect(result.rate).toBeCloseTo(0.12, 2);
    });

    it("handles zero AI tickets", async () => {
      mockCount.mockResolvedValue(0);

      const { getEscalationRate } = await import("../actions");
      const result = await getEscalationRate(COMPANY_ID, PERIOD);

      expect(result.rate).toBe(0);
    });
  });

  describe("getTopTools", () => {
    it("aggregates tool usage from suggestion analysis", async () => {
      mockFindMany.mockResolvedValue([
        { analysis: { toolsExecuted: ["searchKnowledgeBase", "sendMessage"] } },
        { analysis: { toolsExecuted: ["searchKnowledgeBase", "escalate"] } },
        { analysis: { toolsExecuted: ["sendMessage"] } },
        { analysis: null },
        { analysis: { intent: "greeting" } },
      ]);

      const { getTopTools } = await import("../actions");
      const result = await getTopTools(COMPANY_ID, PERIOD);

      expect(result[0]).toEqual({ tool: "searchKnowledgeBase", count: 2 });
      expect(result[1]).toEqual({ tool: "sendMessage", count: 2 });
      expect(result[2]).toEqual({ tool: "escalate", count: 1 });
    });
  });
});
