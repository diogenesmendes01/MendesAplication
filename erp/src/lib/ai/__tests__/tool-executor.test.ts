/**
 * Tests for tool-executor.ts — executeRespondEmail real (production) path.
 *
 * Covers WARN #3 from QA review (PR #71):
 *   - Ticket não encontrado
 *   - Email inválido / ausente
 *   - Happy path: TicketMessage criado + enfileirado no emailOutboundQueue
 *   - Validates sanitization is applied before queuing
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSendTextMessage = vi.fn();
const mockEmailQueueAdd = vi.fn().mockResolvedValue(undefined);
const mockTicketFindUnique = vi.fn();
const mockTicketMessageCreate = vi.fn().mockResolvedValue({ id: "msg-created-1" });
const mockSearchDocuments = vi.fn().mockResolvedValue([]);
const mockClientFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: {
      findUnique: (...args: unknown[]) => mockTicketFindUnique(...args),
      update: vi.fn().mockResolvedValue({}),
    },
    ticketMessage: {
      create: (...args: unknown[]) => mockTicketMessageCreate(...args),
      findMany: vi.fn().mockResolvedValue([]),
    },
    client: {
      findUnique: (...args: unknown[]) => mockClientFindUnique(...args),
    },
    aiDocument: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/whatsapp-api", () => ({
  sendTextMessage: (...args: unknown[]) => mockSendTextMessage(...args),
}));

vi.mock("@/lib/queue", () => ({
  emailOutboundQueue: {
    add: (...args: unknown[]) => mockEmailQueueAdd(...args),
  },
}));

vi.mock("@/lib/ai/embeddings", () => ({
  searchDocuments: (...args: unknown[]) => mockSearchDocuments(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRealContext(overrides = {}) {
  return {
    ticketId: "ticket-real-1",
    companyId: "company-1",
    clientId: "client-1",
    contactPhone: "5511999999999",
    channel: "EMAIL" as const,
    dryRun: false, // ← real path
    ...overrides,
  };
}

function makeTicket(emailOverride?: string | null, contactEmail?: string | null) {
  return {
    id: "ticket-real-1",
    clientId: "client-1",
    contact: contactEmail !== undefined
      ? { email: contactEmail }
      : null,
    client: { email: emailOverride !== undefined ? emailOverride : "cliente@empresa.com" },
  };
}

// ─── executeRespondEmail — real path ────────────────────────────────────────

describe("executeTool — RESPOND_EMAIL real path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it("creates TicketMessage and enqueues email on happy path (contact email)", async () => {
    mockTicketFindUnique.mockResolvedValue(makeTicket(undefined, "contato@cliente.com"));

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Re: Suporte", message: "Olá, analisamos seu caso." },
      makeRealContext()
    );

    // Should succeed
    expect(result).toContain("enfileirado");
    expect(result).toContain("contato@cliente.com");

    // TicketMessage must be created
    expect(mockTicketMessageCreate).toHaveBeenCalledOnce();
    expect(mockTicketMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketId: "ticket-real-1",
          channel: "EMAIL",
          direction: "OUTBOUND",
          isAiGenerated: true,
        }),
      })
    );

    // Email must be enqueued
    expect(mockEmailQueueAdd).toHaveBeenCalledOnce();
    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({
        ticketId: "ticket-real-1",
        companyId: "company-1",
        to: "contato@cliente.com",
        subject: "Re: Suporte",
      })
    );
  });

  it("falls back to client.email when contact.email is null", async () => {
    mockTicketFindUnique.mockResolvedValue(makeTicket("fallback@empresa.com", null));

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Atendimento", message: "Resposta aqui." },
      makeRealContext()
    );

    expect(result).toContain("fallback@empresa.com");
    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({ to: "fallback@empresa.com" })
    );
  });

  // ── Ticket não encontrado ────────────────────────────────────────────────

  it("returns error string when ticket is not found", async () => {
    mockTicketFindUnique.mockResolvedValue(null);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Suporte", message: "Olá" },
      makeRealContext()
    );

    expect(result).toMatch(/ticket nao encontrado/i);
    expect(mockTicketMessageCreate).not.toHaveBeenCalled();
    expect(mockEmailQueueAdd).not.toHaveBeenCalled();
  });

  // ── Email inválido / ausente ─────────────────────────────────────────────

  it("returns error when both contact.email and client.email are null", async () => {
    mockTicketFindUnique.mockResolvedValue(makeTicket(null, null));

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Suporte", message: "Olá" },
      makeRealContext()
    );

    expect(result).toMatch(/email/i);
    expect(result).toMatch(/(nao foi possivel|nao encontrado)/i);
    expect(mockTicketMessageCreate).not.toHaveBeenCalled();
    expect(mockEmailQueueAdd).not.toHaveBeenCalled();
  });

  it("returns error when email address is malformed", async () => {
    // Ticket has malformed email
    mockTicketFindUnique.mockResolvedValue(makeTicket("not-an-email", null));

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Suporte", message: "Olá" },
      makeRealContext()
    );

    expect(result).toMatch(/email/i);
    expect(mockEmailQueueAdd).not.toHaveBeenCalled();
  });

  // ── Validação de args ────────────────────────────────────────────────────

  it("returns error when subject is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { message: "Corpo sem assunto" },
      makeRealContext()
    );

    expect(result).toMatch(/assunto/i);
    expect(result).toMatch(/erro/i);
    expect(mockEmailQueueAdd).not.toHaveBeenCalled();
  });

  it("returns error when message is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Só o assunto" },
      makeRealContext()
    );

    expect(result).toMatch(/mensagem/i);
    expect(result).toMatch(/erro/i);
    expect(mockEmailQueueAdd).not.toHaveBeenCalled();
  });

  // ── Sanitização ──────────────────────────────────────────────────────────

  it("stores sanitized message (strips script tags) in TicketMessage", async () => {
    mockTicketFindUnique.mockResolvedValue(makeTicket(undefined, "dest@cliente.com"));

    const { executeTool } = await import("@/lib/ai/tool-executor");
    await executeTool(
      "RESPOND_EMAIL",
      {
        subject: "Resposta",
        // sanitizeEmailHtml removes non-allowed tags but keeps their text content
        // as plain text — <script> tag is stripped, text inside becomes inert
        message: '<p>Olá</p><script>alert("xss")</script>',
      },
      makeRealContext()
    );

    const createdContent: string =
      mockTicketMessageCreate.mock.calls[0][0].data.content;
    // <p> is in the allow-list, so it remains
    expect(createdContent).toContain("<p>");
    expect(createdContent).toContain("Olá");
    // <script> tag must be stripped (the executable vector is the tag itself)
    expect(createdContent).not.toContain("<script>");
    expect(createdContent).not.toContain("</script>");
  });

  it("passes sanitized content to emailOutboundQueue", async () => {
    mockTicketFindUnique.mockResolvedValue(makeTicket(undefined, "dest@cliente.com"));

    const { executeTool } = await import("@/lib/ai/tool-executor");
    await executeTool(
      "RESPOND_EMAIL",
      {
        subject: "Resposta",
        message: '<b>Importante</b><img src="x" onerror="evil()">',
      },
      makeRealContext()
    );

    const queuedContent: string =
      mockEmailQueueAdd.mock.calls[0][1].content;
    expect(queuedContent).not.toContain("onerror");
    expect(queuedContent).not.toContain("evil");
  });

  // ── messageId passado para a fila ────────────────────────────────────────

  it("passes created TicketMessage id to emailOutboundQueue", async () => {
    mockTicketFindUnique.mockResolvedValue(makeTicket(undefined, "dest@cliente.com"));
    mockTicketMessageCreate.mockResolvedValue({ id: "msg-queued-99" });

    const { executeTool } = await import("@/lib/ai/tool-executor");
    await executeTool(
      "RESPOND_EMAIL",
      { subject: "Test", message: "Corpo" },
      makeRealContext()
    );

    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({ messageId: "msg-queued-99" })
    );
  });
});
