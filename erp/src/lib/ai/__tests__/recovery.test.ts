/**
 * Tests for AI Recovery Queue
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockAdd = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    ticketMessage: {
      create: vi.fn().mockResolvedValue({}),
    },
    aiProviderIncident: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/queue", () => ({
  aiAgentQueue: { add: mockAdd },
}));

vi.mock("@/lib/sse", () => ({
  sseBus: { publish: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  markTicketPendingRecovery,
  processRecoveryQueue,
  getPendingRecoveryCount,
} from "../recovery";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("markTicketPendingRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks ticket as pending recovery", async () => {
    await markTicketPendingRecovery("ticket-1");

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { aiPendingRecovery: true },
    });
  });

  it("creates internal note on ticket", async () => {
    await markTicketPendingRecovery("ticket-1");

    expect(prisma.ticketMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "ticket-1",
        isInternal: true,
        isAiGenerated: true,
        content: expect.stringContaining("indisponível"),
      }),
    });
  });

  it("increments incident ticket count when incident is active", async () => {
    vi.mocked(prisma.aiProviderIncident.findFirst).mockResolvedValueOnce({
      id: "incident-1",
      provider: "openai",
      model: "gpt-4o-mini",
      startedAt: new Date(),
      resolvedAt: null,
      durationMs: null,
      ticketsAffected: 3,
      ticketsRecovered: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await markTicketPendingRecovery("ticket-1");

    expect(prisma.aiProviderIncident.update).toHaveBeenCalledWith({
      where: { id: "incident-1" },
      data: { ticketsAffected: { increment: 1 } },
    });
  });
});

describe("processRecoveryQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero counts when no pending tickets", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([]);

    const result = await processRecoveryQueue();
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it("requeues pending tickets and clears recovery flag", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([
      {
        id: "ticket-1",
        companyId: "company-1",
        channelType: "WHATSAPP",
        messages: [{ content: "Olá" }],
      },
      {
        id: "ticket-2",
        companyId: "company-1",
        channelType: "EMAIL",
        messages: [{ content: "Help" }],
      },
    ] as any);

    const result = await processRecoveryQueue();

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(prisma.ticket.update).toHaveBeenCalledTimes(2);
  });

  it("emits SSE recovery events", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce([
      {
        id: "ticket-1",
        companyId: "company-1",
        channelType: "WHATSAPP",
        messages: [{ content: "Olá" }],
      },
    ] as any);

    await processRecoveryQueue();

    expect(sseBus.publish).toHaveBeenCalledWith(
      "company:company-1:system",
      "ai-recovery-started",
      expect.objectContaining({ ticketCount: 1 }),
    );
    expect(sseBus.publish).toHaveBeenCalledWith(
      "company:company-1:system",
      "ai-recovery-complete",
      expect.objectContaining({ ticketsProcessed: 1 }),
    );
  });
});

describe("getPendingRecoveryCount", () => {
  it("returns count for specific company", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValueOnce(5);

    const count = await getPendingRecoveryCount("company-1");
    expect(count).toBe(5);
    expect(prisma.ticket.count).toHaveBeenCalledWith({
      where: { aiPendingRecovery: true, companyId: "company-1" },
    });
  });

  it("returns global count when no company specified", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValueOnce(10);

    const count = await getPendingRecoveryCount();
    expect(count).toBe(10);
    expect(prisma.ticket.count).toHaveBeenCalledWith({
      where: { aiPendingRecovery: true },
    });
  });
});
