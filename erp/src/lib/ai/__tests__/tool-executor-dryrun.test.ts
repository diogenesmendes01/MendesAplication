/**
 * Tests for executeRespondEmail dry-run path (WARN #5 fix).
 * Real path (DB + queue) requires integration test setup — covered here via dry-run context.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findUnique: vi.fn() },
    ticketMessage: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    client: { findUnique: vi.fn() },
    aiDocument: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/whatsapp-api", () => ({
  sendTextMessage: vi.fn(),
}));

vi.mock("@/lib/queue", () => ({
  emailOutboundQueue: { add: vi.fn() },
}));

vi.mock("@/lib/ai/embeddings", () => ({
  searchDocuments: vi.fn().mockResolvedValue([]),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDryRunContext(overrides = {}) {
  return {
    ticketId: "simulation",
    companyId: "company-1",
    clientId: "simulation",
    contactPhone: "5511999999999",
    channel: "EMAIL" as const,
    dryRun: true,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeTool — RESPOND_EMAIL dry-run path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns simulation string with subject and message", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Re: Suporte", message: "Olá, estamos analisando seu caso." },
      makeDryRunContext()
    );

    expect(result).toContain("[SIMULAÇÃO]");
    expect(result).toContain("Re: Suporte");
    expect(result).toContain("Olá, estamos analisando seu caso.");
  });

  it("returns error when subject is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { message: "Sem assunto" },
      makeDryRunContext()
    );

    expect(result).toMatch(/assunto/i);
    expect(result).toMatch(/erro/i);
  });

  it("returns error when message is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Assunto" },
      makeDryRunContext()
    );

    expect(result).toMatch(/mensagem/i);
    expect(result).toMatch(/erro/i);
  });

  it("does NOT call emailOutboundQueue.add in dry-run", async () => {
    const { emailOutboundQueue } = await import("@/lib/queue");
    const { executeTool } = await import("@/lib/ai/tool-executor");

    await executeTool(
      "RESPOND_EMAIL",
      { subject: "Test", message: "Corpo do email" },
      makeDryRunContext()
    );

    expect(emailOutboundQueue.add).not.toHaveBeenCalled();
  });

  it("does NOT call prisma.ticketMessage.create in dry-run", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { executeTool } = await import("@/lib/ai/tool-executor");

    await executeTool(
      "RESPOND_EMAIL",
      { subject: "Test", message: "Corpo do email" },
      makeDryRunContext()
    );

    expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
  });
});

describe("executeTool — ESCALATE dry-run path", () => {
  it("returns simulation string with escalation reason", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "ESCALATE",
      { reason: "Cliente solicita falar com humano" },
      makeDryRunContext()
    );

    expect(result).toContain("[SIMULAÇÃO]");
    expect(result).toContain("Cliente solicita falar com humano");
  });

  it("uses default reason when reason is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("ESCALATE", {}, makeDryRunContext());

    expect(result).toContain("[SIMULAÇÃO]");
    expect(result.length).toBeGreaterThan(10);
  });
});
