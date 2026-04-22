import { describe, it, expect, vi, beforeEach } from "vitest";
const mockFindMany = vi.fn();
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
vi.mock("@/lib/prisma", () => ({ prisma: { aiFeedback: { findMany: (...args: unknown[]) => mockFindMany(...args), count: vi.fn() } } }));
vi.mock("@/lib/rbac", () => ({ requireCompanyAccess: vi.fn().mockResolvedValue({ userId: "u1", role: "ADMIN" }) }));
import { getFeedbackSummary, getRejectReasons, getEditPatterns, getConfidenceCalibration } from "../actions";
const fb = (o: Record<string, unknown> = {}) => ({ id: "fb-1", type: "positive", category: null, channel: "WHATSAPP", rejectionReason: null, originalResponse: "Resp", editedResponse: null, diff: null, suggestion: { confidence: 0.8 }, ticket: { id: "t-1", subject: "T" }, createdAt: new Date(), ...o });
describe("feedback actions", () => {
  beforeEach(() => vi.clearAllMocks());
  describe("getFeedbackSummary", () => {
    it("returns summary with rates", async () => { mockFindMany.mockResolvedValue([fb({type:"positive",channel:"WHATSAPP"}),fb({type:"positive",channel:"WHATSAPP"}),fb({type:"correction",channel:"EMAIL"}),fb({type:"negative",channel:"WHATSAPP",category:"tone_wrong"})]); const r = await getFeedbackSummary("c1"); expect(r.total).toBe(4); expect(r.positive).toBe(2); expect(r.approvalRate).toBe(0.5); expect(r.byChannel).toHaveLength(2); });
    it("handles empty", async () => { mockFindMany.mockResolvedValue([]); const r = await getFeedbackSummary("c1"); expect(r.total).toBe(0); });
  });
  describe("getRejectReasons", () => {
    it("groups reasons", async () => { mockFindMany.mockResolvedValue([fb({type:"negative",rejectionReason:"Tom formal",category:"tone_wrong"}),fb({type:"negative",rejectionReason:"Tom formal"}),fb({type:"negative",rejectionReason:"Info errada",category:"info_wrong"})]); const r = await getRejectReasons("c1"); expect(r).toHaveLength(2); expect(r[0].count).toBe(2); });
  });
  describe("getEditPatterns", () => {
    it("computes stats", async () => { mockFindMany.mockResolvedValue([fb({diff:{changePercent:15,isMinorEdit:true},editedResponse:"E"}),fb({diff:{changePercent:45,isMinorEdit:false},editedResponse:"E"})]); const r = await getEditPatterns("c1"); expect(r.totalEdits).toBe(2); expect(r.avgChangePercent).toBe(30); });
  });
  describe("getConfidenceCalibration", () => {
    it("buckets by confidence", async () => { mockFindMany.mockResolvedValue([fb({type:"positive",suggestion:{confidence:0.9}}),fb({type:"positive",suggestion:{confidence:0.85}}),fb({type:"negative",suggestion:{confidence:0.3}})]); const r = await getConfidenceCalibration("c1"); expect(r).toHaveLength(5); expect(r.find(b=>b.bucket==="80-100%")?.approvalRate).toBe(1); });
  });
});
