/**
 * Unit tests for SLA Engine.
 * Tests config resolution, status computation, and priority bumping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTicketFindUnique = vi.fn();
const mockTicketFindMany = vi.fn().mockResolvedValue([]);
const mockTicketUpdate = vi.fn().mockResolvedValue({});
const mockSlaConfigFindMany = vi.fn().mockResolvedValue([]);
const mockSlaViolationCreate = vi.fn().mockResolvedValue({});
const mockTicketMessageCreate = vi.fn().mockResolvedValue({});
const mockAuditLogCreate = vi.fn().mockResolvedValue({});
const mockUserCompanyFindFirst = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: {
      findUnique: (...args: unknown[]) => mockTicketFindUnique(...args),
      findMany: (...args: unknown[]) => mockTicketFindMany(...args),
      update: (...args: unknown[]) => mockTicketUpdate(...args),
    },
    slaConfig: {
      findMany: (...args: unknown[]) => mockSlaConfigFindMany(...args),
    },
    slaViolation: {
      create: (...args: unknown[]) => mockSlaViolationCreate(...args),
    },
    ticketMessage: {
      create: (...args: unknown[]) => mockTicketMessageCreate(...args),
    },
    auditLog: {
      create: (...args: unknown[]) => mockAuditLogCreate(...args),
    },
    userCompany: {
      findFirst: (...args: unknown[]) => mockUserCompanyFindFirst(...args),
    },
  },
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

vi.mock("@/lib/sse", () => ({
  sseBus: { publish: vi.fn() },
}));

vi.mock("@/lib/sla", () => ({
  calculateSlaDeadline: (start: Date, minutes: number) =>
    new Date(start.getTime() + minutes * 60000),
}));

import {
  resolveSlaConfig,
  assignSlaToTicket,
  markFirstResponse,
  markResolved,
  getTicketSlaStatus,
} from "../sla-engine";

beforeEach(() => { vi.clearAllMocks(); });

describe("resolveSlaConfig", () => {
  it("returns exact match when channel + priority match", async () => {
    mockSlaConfigFindMany.mockResolvedValue([
      {
        id: "cfg-1", companyId: "co-1", type: "TICKET", priority: "HIGH",
        stage: "first_reply", channelType: "WHATSAPP", deadlineMinutes: 15,
        alertBeforeMinutes: 10, autoEscalate: true, autoPriorityBump: true,
        escalateToRole: "ADMIN", businessHoursOnly: false,
        businessHoursStart: 8, businessHoursEnd: 18,
      },
      {
        id: "cfg-2", companyId: "co-1", type: "TICKET", priority: null,
        stage: "first_reply", channelType: null, deadlineMinutes: 120,
        alertBeforeMinutes: 30, autoEscalate: true, autoPriorityBump: true,
        escalateToRole: null, businessHoursOnly: false,
        businessHoursStart: 8, businessHoursEnd: 18,
      },
    ]);

    const result = await resolveSlaConfig("co-1", "WHATSAPP", "HIGH", "first_reply");
    expect(result.deadlineMinutes).toBe(15);
    expect(result.id).toBe("cfg-1");
  });

  it("falls back to channel-only config", async () => {
    mockSlaConfigFindMany.mockResolvedValue([
      {
        id: "cfg-ch", companyId: "co-1", type: "TICKET", priority: null,
        stage: "first_reply", channelType: "WHATSAPP", deadlineMinutes: 30,
        alertBeforeMinutes: 15, autoEscalate: true, autoPriorityBump: true,
        escalateToRole: null, businessHoursOnly: false,
        businessHoursStart: 8, businessHoursEnd: 18,
      },
    ]);

    const result = await resolveSlaConfig("co-1", "WHATSAPP", "HIGH", "first_reply");
    expect(result.deadlineMinutes).toBe(30);
  });

  it("falls back to priority-only config", async () => {
    mockSlaConfigFindMany.mockResolvedValue([
      {
        id: "cfg-pr", companyId: "co-1", type: "TICKET", priority: "HIGH",
        stage: "first_reply", channelType: null, deadlineMinutes: 60,
        alertBeforeMinutes: 20, autoEscalate: false, autoPriorityBump: true,
        escalateToRole: null, businessHoursOnly: false,
        businessHoursStart: 8, businessHoursEnd: 18,
      },
    ]);

    const result = await resolveSlaConfig("co-1", "EMAIL", "HIGH", "first_reply");
    expect(result.deadlineMinutes).toBe(60);
    expect(result.autoEscalate).toBe(false);
  });

  it("falls back to global config", async () => {
    mockSlaConfigFindMany.mockResolvedValue([
      {
        id: "cfg-gl", companyId: "co-1", type: "TICKET", priority: null,
        stage: "first_reply", channelType: null, deadlineMinutes: 120,
        alertBeforeMinutes: 30, autoEscalate: true, autoPriorityBump: true,
        escalateToRole: null, businessHoursOnly: false,
        businessHoursStart: 8, businessHoursEnd: 18,
      },
    ]);

    const result = await resolveSlaConfig("co-1", "EMAIL", "LOW", "first_reply");
    expect(result.deadlineMinutes).toBe(120);
  });

  it("returns hardcoded defaults when no configs exist", async () => {
    mockSlaConfigFindMany.mockResolvedValue([]);

    const result = await resolveSlaConfig("co-1", "EMAIL", "MEDIUM", "first_reply");
    expect(result.deadlineMinutes).toBe(120);
    expect(result.alertBeforeMinutes).toBe(30);
    expect(result.id).toBeNull();
  });

  it("returns resolution default when no configs exist", async () => {
    mockSlaConfigFindMany.mockResolvedValue([]);

    const result = await resolveSlaConfig("co-1", null, "HIGH", "resolution");
    expect(result.deadlineMinutes).toBe(1440);
  });
});

describe("assignSlaToTicket", () => {
  it("sets slaFirstReply and slaResolution on the ticket", async () => {
    mockSlaConfigFindMany.mockResolvedValue([]);
    mockTicketUpdate.mockResolvedValue({});

    const createdAt = new Date("2026-03-28T10:00:00Z");
    await assignSlaToTicket("tk-1", "co-1", "WHATSAPP", "HIGH", createdAt);

    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tk-1" },
        data: expect.objectContaining({
          slaFirstReply: expect.any(Date),
          slaResolution: expect.any(Date),
        }),
      })
    );

    const call = mockTicketUpdate.mock.calls[0][0];
    const firstReply = call.data.slaFirstReply as Date;
    const resolution = call.data.slaResolution as Date;
    expect(firstReply.getTime() - createdAt.getTime()).toBe(120 * 60000);
    expect(resolution.getTime() - createdAt.getTime()).toBe(1440 * 60000);
  });
});

describe("markFirstResponse", () => {
  it("sets slaFirstReplyAt when not already set", async () => {
    mockTicketFindUnique.mockResolvedValue({
      id: "tk-1", slaFirstReply: new Date("2026-03-28T12:00:00Z"),
      slaFirstReplyAt: null, slaBreached: false,
    });
    mockTicketUpdate.mockResolvedValue({});

    await markFirstResponse("tk-1");

    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tk-1" },
        data: expect.objectContaining({ slaFirstReplyAt: expect.any(Date) }),
      })
    );
  });

  it("does nothing if already marked", async () => {
    mockTicketFindUnique.mockResolvedValue({
      id: "tk-1", slaFirstReply: new Date("2026-03-28T12:00:00Z"),
      slaFirstReplyAt: new Date("2026-03-28T11:00:00Z"), slaBreached: false,
    });

    await markFirstResponse("tk-1");
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("does nothing if ticket not found", async () => {
    mockTicketFindUnique.mockResolvedValue(null);
    await markFirstResponse("tk-nonexistent");
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });
});

describe("markResolved", () => {
  it("sets slaResolvedAt and clears slaAtRisk", async () => {
    mockTicketFindUnique.mockResolvedValue({ id: "tk-1", slaResolvedAt: null });
    mockTicketUpdate.mockResolvedValue({});

    await markResolved("tk-1");

    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tk-1" },
        data: expect.objectContaining({ slaResolvedAt: expect.any(Date), slaAtRisk: false }),
      })
    );
  });

  it("does nothing if already resolved", async () => {
    mockTicketFindUnique.mockResolvedValue({
      id: "tk-1", slaResolvedAt: new Date("2026-03-28T12:00:00Z"),
    });

    await markResolved("tk-1");
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });
});

describe("getTicketSlaStatus", () => {
  it("returns null for non-existent ticket", async () => {
    mockTicketFindUnique.mockResolvedValue(null);
    const result = await getTicketSlaStatus("tk-nonexistent");
    expect(result).toBeNull();
  });

  it("returns ok status for ticket within SLA", async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 30 * 60000);
    const deadline = new Date(now.getTime() + 90 * 60000);

    mockTicketFindUnique.mockResolvedValue({
      id: "tk-1", slaFirstReply: deadline,
      slaResolution: new Date(now.getTime() + 24 * 60 * 60000),
      slaFirstReplyAt: null, slaResolvedAt: null,
      slaBreached: false, slaAtRisk: false, createdAt,
    });

    const result = await getTicketSlaStatus("tk-1");
    expect(result).not.toBeNull();
    expect(result!.overallStatus).toBe("ok");
    expect(result!.firstResponse.minutesRemaining).toBeGreaterThan(0);
  });

  it("returns breached status when deadline passed", async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 180 * 60000);
    const deadline = new Date(now.getTime() - 60 * 60000);

    mockTicketFindUnique.mockResolvedValue({
      id: "tk-1", slaFirstReply: deadline,
      slaResolution: new Date(now.getTime() + 24 * 60 * 60000),
      slaFirstReplyAt: null, slaResolvedAt: null,
      slaBreached: true, slaAtRisk: false, createdAt,
    });

    const result = await getTicketSlaStatus("tk-1");
    expect(result!.firstResponse.status).toBe("breached");
    expect(result!.overallStatus).toBe("breached");
  });

  it("returns ok when both responded and resolved", async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 120 * 60000);

    mockTicketFindUnique.mockResolvedValue({
      id: "tk-1",
      slaFirstReply: new Date(now.getTime() + 60 * 60000),
      slaResolution: new Date(now.getTime() + 24 * 60 * 60000),
      slaFirstReplyAt: new Date(createdAt.getTime() + 10 * 60000),
      slaResolvedAt: new Date(createdAt.getTime() + 60 * 60000),
      slaBreached: false, slaAtRisk: false, createdAt,
    });

    const result = await getTicketSlaStatus("tk-1");
    expect(result!.firstResponse.respondedAt).not.toBeNull();
    expect(result!.resolution.respondedAt).not.toBeNull();
    expect(result!.overallStatus).toBe("ok");
  });

  it("returns at_risk when > 80% consumed", async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 100 * 60000);
    const deadline = new Date(now.getTime() + 10 * 60000); // 10 min left out of 110 total (~91%)

    mockTicketFindUnique.mockResolvedValue({
      id: "tk-1", slaFirstReply: deadline,
      slaResolution: new Date(now.getTime() + 24 * 60 * 60000),
      slaFirstReplyAt: null, slaResolvedAt: null,
      slaBreached: false, slaAtRisk: false, createdAt,
    });

    const result = await getTicketSlaStatus("tk-1");
    expect(result!.firstResponse.status).toBe("at_risk");
    expect(result!.overallStatus).toBe("at_risk");
  });
});
