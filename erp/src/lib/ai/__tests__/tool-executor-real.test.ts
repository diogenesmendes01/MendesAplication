/**
 * Tests for executeRespondEmail — real (non-dry-run) path.
 *
 * Covers the scenarios identified in WARN-3 of the QA review:
 *   - Happy path: ticketMessage created + queue enqueued
 *   - Ticket not found in DB
 *   - No valid recipient email (contact and client both null / invalid)
 *   - emailOutboundQueue.add throws
 *   - prisma.ticketMessage.create throws
 *   - Invalid email format rejected by EMAIL_REGEX
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockTicketMessage = { id: "msg-1" };

const mockPrisma = {
  ticket: { findUnique: vi.fn() },
  ticketMessage: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  client: { findUnique: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const mockSendTextMessage = vi.fn();
vi.mock("@/lib/whatsapp-api", () => ({ sendTextMessage: mockSendTextMessage }));

const mockQueueAdd = vi.fn();
vi.mock("@/lib/queue", () => ({
  emailOutboundQueue: { add: mockQueueAdd },
}));

vi.mock("@/lib/ai/embeddings", () => ({
  searchDocuments: vi.fn().mockResolvedValue([]),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRealContext(overrides = {}) {
  return {
    ticketId: "ticket-123",
    companyId: "company-1",
    clientId: "client-1",
    contactPhone: "5511999999999",
    channel: "EMAIL" as const,
    dryRun: false,
    ...overrides,
  };
}

function makeTicket(
  contactEmail: string | null = "cliente@exemplo.com",
  clientEmail: string | null = null
) {
  return {
    id: "ticket-123",
    contact: contactEmail ? { email: contactEmail } : null,
    client: clientEmail ? { email: clientEmail } : null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeRespondEmail — real path (dryRun: false)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.ticketMessage.create.mockResolvedValue(mockTicketMessage);
    mockQueueAdd.mockResolvedValue(undefined);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("creates ticketMessage and enqueues email on happy path (contact email)", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket("cliente@exemplo.com", null)
    );

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Re: Suporte", message: "Olá, estamos analisando." },
      makeRealContext()
    );

    expect(result).toContain("cliente@exemplo.com");
    expect(result).toContain("Re: Suporte");

    expect(mockPrisma.ticketMessage.create).toHaveBeenCalledOnce();
    expect(mockPrisma.ticketMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketId: "ticket-123",
          channel: "EMAIL",
          direction: "OUTBOUND",
          isAiGenerated: true,
        }),
      })
    );

    expect(mockQueueAdd).toHaveBeenCalledOnce();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({
        messageId: "msg-1",
        ticketId: "ticket-123",
        companyId: "company-1",
        to: "cliente@exemplo.com",
        subject: "Re: Suporte",
      })
    );
  });

  it("uses client email as fallback when contact.email is null", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket(null, "cliente-fallback@exemplo.com")
    );

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Assunto", message: "Corpo" },
      makeRealContext()
    );

    expect(result).toContain("cliente-fallback@exemplo.com");
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({ to: "cliente-fallback@exemplo.com" })
    );
  });

  // ── Ticket not found ────────────────────────────────────────────────────────

  it("returns error message when ticket is not found", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(null);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Assunto", message: "Corpo" },
      makeRealContext()
    );

    expect(result).toMatch(/ticket.*nao encontrado/i);
    expect(mockPrisma.ticketMessage.create).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  // ── No valid recipient email ────────────────────────────────────────────────

  it("returns error when contact and client both have null emails", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(makeTicket(null, null));

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Assunto", message: "Corpo" },
      makeRealContext()
    );

    expect(result).toMatch(/email.*contato|email.*cliente|encontrar.*email/i);
    expect(mockPrisma.ticketMessage.create).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns error when email is invalid format (fails EMAIL_REGEX)", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket("not-an-email", null)
    );

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Assunto", message: "Corpo" },
      makeRealContext()
    );

    expect(result).toMatch(/email.*contato|email.*cliente|encontrar.*email/i);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  // ── Missing args ────────────────────────────────────────────────────────────

  it("returns error when subject is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { message: "Corpo" },
      makeRealContext()
    );

    expect(result).toMatch(/assunto/i);
    expect(result).toMatch(/erro/i);
    expect(mockPrisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("returns error when message is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Assunto" },
      makeRealContext()
    );

    expect(result).toMatch(/mensagem/i);
    expect(result).toMatch(/erro/i);
    expect(mockPrisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  // ── Queue failure ───────────────────────────────────────────────────────────

  it("returns error string when emailOutboundQueue.add throws", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket("cliente@exemplo.com")
    );
    mockQueueAdd.mockRejectedValue(new Error("Queue connection refused"));

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Assunto", message: "Corpo" },
      makeRealContext()
    );

    // executeTool wraps errors via try/catch — should not throw
    expect(result).toMatch(/erro.*RESPOND_EMAIL|Queue connection refused/i);
  });

  // ── DB failure ──────────────────────────────────────────────────────────────

  it("returns error string when prisma.ticketMessage.create throws", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket("cliente@exemplo.com")
    );
    mockPrisma.ticketMessage.create.mockRejectedValue(
      new Error("DB connection lost")
    );

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Assunto", message: "Corpo" },
      makeRealContext()
    );

    // executeTool wraps errors via try/catch — should not throw
    expect(result).toMatch(/erro.*RESPOND_EMAIL|DB connection lost/i);
    // Queue must NOT be called after create throws
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
