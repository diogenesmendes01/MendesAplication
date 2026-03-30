import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockChannelFindMany = vi.fn();
const mockChannelUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: {
      findMany: (...args: unknown[]) => mockChannelFindMany(...args),
      update: (...args: unknown[]) => mockChannelUpdate(...args),
    },
    ticket: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    client: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "client-1" }),
      findUnique: vi.fn().mockResolvedValue({ name: "Test Client" }),
    },
    attachment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    ticketMessage: {
      create: vi.fn().mockResolvedValue({ id: "msg-1" }),
    },
    $transaction: vi.fn().mockImplementation((fn: (...args: unknown[]) => string) =>
      fn({
        client: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "client-1" }),
        },
        ticket: {
          create: vi.fn().mockResolvedValue({ id: "ticket-1" }),
        },
        attachment: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
        ticketMessage: {
          create: vi.fn().mockResolvedValue({ id: "msg-1" }),
        },
      })
    ),
  },
}));

vi.mock("@/lib/encryption", () => ({
  decryptConfig: (config: unknown) => config,
}));

vi.mock("@/lib/queue", () => ({
  aiAgentQueue: { add: vi.fn() },
}));

// Use a class-based mock for ReclameAquiClient to support `new`
const mockAuthenticate = vi.fn().mockResolvedValue({});
const mockCheckTicketAvailability = vi.fn().mockResolvedValue(true);
const mockCountTickets = vi.fn();
const mockGetTickets = vi.fn();

vi.mock("@/lib/reclameaqui/client", () => {
  const MockReclameAquiClient = vi.fn(function (this: Record<string, unknown>) {
    this.authenticate = mockAuthenticate;
    this.checkTicketAvailability = mockCheckTicketAvailability;
    this.countTickets = mockCountTickets;
    this.getTickets = mockGetTickets;
  });

  return {
    ReclameAquiClient: MockReclameAquiClient,
    ReclameAquiError: class extends Error {
      code: number;
      httpStatus: number;
      originalMessage: string;
      constructor(msg: string, code: number, httpStatus: number, orig: string) {
        super(msg);
        this.code = code;
        this.httpStatus = httpStatus;
        this.originalMessage = orig;
      }
    },
  };
});

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

import { processReclameAquiInbound } from "../reclameaqui-inbound";
import { logger } from "@/lib/logger";
import type { Job } from "bullmq";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const makeChannel = (overrides?: Partial<{
  id: string;
  companyId: string;
  lastSyncAt: Date | null;
  config: Record<string, unknown>;
}>) => ({
  id: "ch-1",
  companyId: "comp-1",
  lastSyncAt: new Date("2026-03-27T10:00:00Z"),
  config: {
    clientId: "test-client",
    clientSecret: "test-secret",
    baseUrl: "https://app.hugme.com.br/api",
    lastSyncDate: "2026-03-27T10:00:00.000Z",
  },
  ...overrides,
});

const fakeJob = {} as Job;

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("reclameaqui-inbound count-first polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannelUpdate.mockResolvedValue({});
    mockAuthenticate.mockResolvedValue({});
    mockCheckTicketAvailability.mockResolvedValue(true);
  });

  it("skips full sync when countTickets returns 0", async () => {
    mockChannelFindMany.mockResolvedValue([makeChannel()]);
    mockCountTickets.mockResolvedValue({ data: 0 });

    await processReclameAquiInbound(fakeJob);

    // Count was called
    expect(mockCountTickets).toHaveBeenCalledTimes(1);
    expect(mockCountTickets).toHaveBeenCalledWith({
      last_modification_date: {
        comparator: "gte",
        value: "2026-03-27T10:00:00.000Z",
      },
    });

    // getTickets was NOT called (skipped)
    expect(mockGetTickets).not.toHaveBeenCalled();

    // lastSyncAt was still updated
    expect(mockChannelUpdate).toHaveBeenCalledTimes(1);
    expect(mockChannelUpdate.mock.calls[0][0].data.lastSyncAt).toBeInstanceOf(Date);

    // Informative skip log
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("No changes since")
    );
  });

  it("proceeds with full sync when countTickets returns > 0", async () => {
    mockChannelFindMany.mockResolvedValue([makeChannel()]);
    mockCountTickets.mockResolvedValue({ data: 3 });
    mockGetTickets.mockResolvedValue({
      data: [],
      meta: { total: 0, page: { number: 1, size: 50 } },
    });

    await processReclameAquiInbound(fakeJob);

    expect(mockCountTickets).toHaveBeenCalledTimes(1);
    expect(mockGetTickets).toHaveBeenCalledTimes(1);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("3 ticket(s) modified since")
    );
  });

  it("uses DB lastSyncAt over config.lastSyncDate", async () => {
    const dbDate = new Date("2026-03-28T00:00:00Z");
    mockChannelFindMany.mockResolvedValue([
      makeChannel({
        lastSyncAt: dbDate,
        config: {
          clientId: "test-client",
          clientSecret: "test-secret",
          baseUrl: "https://app.hugme.com.br/api",
          lastSyncDate: "2026-03-20T00:00:00.000Z", // older config date
        },
      }),
    ]);
    mockCountTickets.mockResolvedValue({ data: 0 });

    await processReclameAquiInbound(fakeJob);

    // Should use DB date (newer), not config date
    expect(mockCountTickets).toHaveBeenCalledWith({
      last_modification_date: {
        comparator: "gte",
        value: dbDate.toISOString(),
      },
    });
  });

  it("falls back to config.lastSyncDate when DB lastSyncAt is null", async () => {
    mockChannelFindMany.mockResolvedValue([
      makeChannel({ lastSyncAt: null }),
    ]);
    mockCountTickets.mockResolvedValue({ data: 0 });

    await processReclameAquiInbound(fakeJob);

    expect(mockCountTickets).toHaveBeenCalledWith({
      last_modification_date: {
        comparator: "gte",
        value: "2026-03-27T10:00:00.000Z",
      },
    });
  });

  it("uses 365-day lookback on first sync (no DB lastSyncAt, no config lastSyncDate)", async () => {
    mockChannelFindMany.mockResolvedValue([
      makeChannel({
        lastSyncAt: null,
        config: {
          clientId: "test-client",
          clientSecret: "test-secret",
          baseUrl: "https://app.hugme.com.br/api",
        },
      }),
    ]);
    mockCountTickets.mockResolvedValue({ data: 0 });

    await processReclameAquiInbound(fakeJob);

    // First sync: both lastSyncAt (DB) and lastSyncDate (config) are absent →
    // should use a 365-day lookback window, not the 7-day fallback.
    const callArg = mockCountTickets.mock.calls[0][0];
    const syncDate = new Date(callArg.last_modification_date.value);
    const daysDiff = (Date.now() - syncDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeGreaterThan(364);
    expect(daysDiff).toBeLessThan(366);
  });

  it("skips channel when API is unavailable", async () => {
    mockChannelFindMany.mockResolvedValue([makeChannel()]);
    mockCheckTicketAvailability.mockResolvedValue(false);

    await processReclameAquiInbound(fakeJob);

    expect(mockCountTickets).not.toHaveBeenCalled();
    expect(mockGetTickets).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Ticket API indisponível")
    );
  });

  it("handles no active channels gracefully", async () => {
    mockChannelFindMany.mockResolvedValue([]);

    await processReclameAquiInbound(fakeJob);

    expect(mockCountTickets).not.toHaveBeenCalled();
    expect(mockGetTickets).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("No active RECLAMEAQUI channels found")
    );
  });

  it("rate limit respected: count = 1 call, sync = N paginated calls", async () => {
    mockChannelFindMany.mockResolvedValue([makeChannel()]);
    mockCountTickets.mockResolvedValue({ data: 60 });

    const makeTicket = (extId: string) => ({
      source_external_id: extId,
      ra_status: { id: 5, name: "Não respondido" },
      customer: { name: "Test", email: [], cpf: [], phone_numbers: [] },
      complaint_title: "Test",
      complaint_content: "Test",
      complaint_response_content: null,
      creation_date: "2026-03-28T00:00:00Z",
      last_modification_date: "2026-03-28T00:00:00Z",
      company: { companyId: 1, name: "Test" },
      hugme_status: { id: 1, name: "Pendente" },
      request_evaluation: false,
      request_moderation: false,
      resolved_issue: null,
      back_doing_business: null,
      rating: null,
      interactions: [],
      moderation: null,
      ra_reason: null,
      ra_feeling: null,
      categories: [],
      consumer_consideration: null,
      consumer_consideration_date: null,
      company_consideration: null,
      company_consideration_date: null,
      public_treatment_time: null,
      private_treatment_time: null,
      rating_date: null,
      comments_count: 0,
      interactions_not_readed_count: 0,
      whatsapp: null,
      active: true,
      frozen: false,
    });

    // Simulate 2 pages of results
    mockGetTickets
      .mockResolvedValueOnce({
        data: Array(50).fill(makeTicket("ext-1")),
        meta: { total: 60, page: { number: 1, size: 50 } },
      })
      .mockResolvedValueOnce({
        data: Array(10).fill(makeTicket("ext-2")),
        meta: { total: 60, page: { number: 2, size: 50 } },
      });

    await processReclameAquiInbound(fakeJob);

    // 1 count call + 2 paginated calls
    expect(mockCountTickets).toHaveBeenCalledTimes(1);
    expect(mockGetTickets).toHaveBeenCalledTimes(2);
  });
});

// ─── Unit tests for exported helpers ───────────────────────────────────────

describe("resolveLastSyncDate", () => {
  let resolveLastSyncDate: (...args: unknown[]) => string;

  beforeEach(async () => {
    const mod = await import("../reclameaqui-inbound");
    resolveLastSyncDate = (mod as unknown as Record<string, (...args: unknown[]) => string>)._resolveLastSyncDate;
  });

  it("returns DB date when available", () => {
    const dbDate = new Date("2026-03-28T12:00:00Z");
    expect(resolveLastSyncDate(dbDate, "2026-03-20T00:00:00Z")).toBe(dbDate.toISOString());
  });

  it("returns config date when DB is null", () => {
    expect(resolveLastSyncDate(null, "2026-03-20T00:00:00Z")).toBe("2026-03-20T00:00:00Z");
  });

  it("returns 7 days ago when both are empty", () => {
    const result = resolveLastSyncDate(null);
    const date = new Date(result);
    const daysDiff = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeGreaterThan(6.9);
    expect(daysDiff).toBeLessThan(7.1);
  });
});

describe("countModifiedTickets", () => {
  it("returns the count from API response", async () => {
    const mod = await import("../reclameaqui-inbound");
    const countModifiedTickets = (mod as unknown as Record<string, (...args: unknown[]) => string>)._countModifiedTickets;

    const mockClient = {
      countTickets: vi.fn().mockResolvedValue({ data: 42 }),
    };

    const result = await countModifiedTickets(mockClient, "2026-03-27T00:00:00Z");
    expect(result).toBe(42);
    expect(mockClient.countTickets).toHaveBeenCalledWith({
      last_modification_date: {
        comparator: "gte",
        value: "2026-03-27T00:00:00Z",
      },
    });
  });

  it("returns 0 when API returns undefined data", async () => {
    const mod = await import("../reclameaqui-inbound");
    const countModifiedTickets = (mod as unknown as Record<string, (...args: unknown[]) => string>)._countModifiedTickets;

    const mockClient = {
      countTickets: vi.fn().mockResolvedValue({}),
    };

    const result = await countModifiedTickets(mockClient, "2026-03-27T00:00:00Z");
    expect(result).toBe(0);
  });
});
