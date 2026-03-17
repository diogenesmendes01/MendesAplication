/**
 * Integration tests for runAgent — real (non-dry-run) EMAIL path.
 *
 * Covers the gap identified in WARN-4 of the QA review (PR #71):
 *   runAgent(ticketId, companyId, msg, "EMAIL") → decrypt API key →
 *   build email system prompt → chatCompletion → executeTool("RESPOND_EMAIL")
 *
 * Tests cover:
 *   - Happy path: RESPOND_EMAIL tool called with correct context
 *   - AI disabled / email channel disabled
 *   - Ticket not found
 *   - API key decrypt failure
 *   - ESCALATE tool path
 *   - Direct text response (no tool calls)
 *   - Daily spend limit reached
 *   - Escalation keyword fast-path (no LLM call)
 *   - logUsage called with isSimulation: false (production path)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockChatCompletion = vi.fn();
const mockGetEnvProviderConfig = vi.fn();
const mockExecuteTool = vi.fn();
const mockDecrypt = vi.fn((v: string) => `decrypted:${v}`);
const mockGetTodaySpend = vi.fn();
const mockLogUsage = vi.fn();

vi.mock("@/lib/ai/provider", () => ({
  chatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
  getEnvProviderConfig: () => mockGetEnvProviderConfig(),
}));

vi.mock("@/lib/ai/tool-executor", () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
}));

vi.mock("@/lib/encryption", () => ({
  decrypt: (v: string) => mockDecrypt(v),
}));

vi.mock("@/lib/ai/cost-tracker", () => ({
  getTodaySpend: (...args: unknown[]) => mockGetTodaySpend(...args),
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock("@/lib/ai/tools", () => ({
  getToolsForChannel: vi.fn().mockReturnValue([]),
}));

// Base AI config used in tests
const mockAiConfig = {
  id: "config-1",
  companyId: "company-1",
  enabled: true,
  persona: "Assistente de suporte",
  welcomeMessage: "Olá!",
  escalationKeywords: [],
  maxIterations: 3,
  provider: "openai",
  apiKey: "encrypted-api-key",
  model: "gpt-4o",
  whatsappEnabled: true,
  emailEnabled: true,
  emailPersona: "Assistente de suporte por email",
  emailSignature: "Atenciosamente,\nEquipe de Suporte",
  dailySpendLimitBrl: null,
  temperature: 0.7,
};

// Base ticket with email contact
const mockTicket = {
  id: "ticket-123",
  clientId: "client-1",
  status: "OPEN",
  aiEnabled: true,
  contact: { id: "contact-1", name: "João Silva", whatsapp: null, email: "joao@exemplo.com" },
  client: { id: "client-1", name: "João Silva", telefone: null },
};

const mockAiConfigFindUnique = vi.fn();
const mockTicketFindUnique = vi.fn();
const mockTicketMessageFindMany = vi.fn();
const mockTicketUpdate = vi.fn();
const mockTicketMessageCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiConfig: {
      findUnique: (...args: unknown[]) => mockAiConfigFindUnique(...args),
    },
    ticket: {
      findUnique: (...args: unknown[]) => mockTicketFindUnique(...args),
      update: (...args: unknown[]) => mockTicketUpdate(...args),
    },
    ticketMessage: {
      findMany: (...args: unknown[]) => mockTicketMessageFindMany(...args),
      create: (...args: unknown[]) => mockTicketMessageCreate(...args),
    },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRespondEmailToolCall(subject = "Re: Suporte", message = "Olá, analisamos seu caso.") {
  return {
    content: null,
    tool_calls: [
      {
        id: "call-respond-email",
        function: {
          name: "RESPOND_EMAIL",
          arguments: JSON.stringify({ subject, message }),
        },
      },
    ],
    usage: { inputTokens: 200, outputTokens: 100 },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runAgent — real EMAIL path (dryRun: false)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAiConfigFindUnique.mockResolvedValue(mockAiConfig);
    mockTicketFindUnique.mockResolvedValue(mockTicket);
    mockTicketMessageFindMany.mockResolvedValue([]);
    mockTicketUpdate.mockResolvedValue({});
    mockTicketMessageCreate.mockResolvedValue({ id: "msg-1" });
    mockGetTodaySpend.mockResolvedValue(0);
    mockLogUsage.mockResolvedValue(undefined);
    mockDecrypt.mockImplementation((v: string) => `decrypted:${v}`);
    mockGetEnvProviderConfig.mockResolvedValue({
      provider: "openai",
      apiKey: "env-key",
      model: "gpt-4o",
    });
    mockExecuteTool.mockResolvedValue("Email enviado com sucesso");
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("returns responded:true when RESPOND_EMAIL tool is called", async () => {
    mockChatCompletion.mockResolvedValue(makeRespondEmailToolCall());

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-1", "Preciso de ajuda por email", "EMAIL");

    expect(result.responded).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.iterations).toBe(1);
  });

  it("decrypts API key and passes provider config to chatCompletion", async () => {
    mockChatCompletion.mockResolvedValue(makeRespondEmailToolCall());

    const { runAgent } = await import("@/lib/ai/agent");
    await runAgent("ticket-123", "company-1", "Dúvida por email", "EMAIL");

    expect(mockDecrypt).toHaveBeenCalledWith("encrypted-api-key");
    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        provider: "openai",
        apiKey: "decrypted:encrypted-api-key",
        model: "gpt-4o",
      })
    );
  });

  it("uses emailPersona in system prompt when channel is EMAIL", async () => {
    mockChatCompletion.mockResolvedValue(makeRespondEmailToolCall());

    const { runAgent } = await import("@/lib/ai/agent");
    await runAgent("ticket-123", "company-1", "Mensagem por email", "EMAIL");

    // First argument to chatCompletion is messages array — first message is system prompt
    const messages = mockChatCompletion.mock.calls[0][0];
    const systemMessage = messages.find((m: { role: string }) => m.role === "system");
    expect(systemMessage?.content).toContain("Email");
    expect(systemMessage?.content).toContain("Assistente de suporte por email");
    expect(systemMessage?.content).toContain("RESPOND_EMAIL");
    expect(systemMessage?.content).toContain("Atenciosamente,\nEquipe de Suporte"); // signature
  });

  it("calls executeTool with RESPOND_EMAIL and correct toolContext (dryRun: false)", async () => {
    mockChatCompletion.mockResolvedValue(makeRespondEmailToolCall("Re: Atendimento", "Resposta completa"));

    const { runAgent } = await import("@/lib/ai/agent");
    await runAgent("ticket-123", "company-1", "Email de cliente", "EMAIL");

    expect(mockExecuteTool).toHaveBeenCalledWith(
      "RESPOND_EMAIL",
      expect.objectContaining({ subject: "Re: Atendimento", message: "Resposta completa" }),
      expect.objectContaining({
        ticketId: "ticket-123",
        companyId: "company-1",
        channel: "EMAIL",
        dryRun: false,
      })
    );
  });

  it("logs usage with isSimulation: false (production path)", async () => {
    mockChatCompletion.mockResolvedValue(makeRespondEmailToolCall());

    const { runAgent } = await import("@/lib/ai/agent");
    await runAgent("ticket-123", "company-1", "Email", "EMAIL");

    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        aiConfigId: "config-1",
        companyId: "company-1",
        channel: "EMAIL",
        provider: "openai",
        model: "gpt-4o",
        ticketId: "ticket-123",
        inputTokens: 200,
        outputTokens: 100,
        // isSimulation must NOT be true — this is the real path
      })
    );
    // Ensure isSimulation is not passed or is falsy
    const call = mockLogUsage.mock.calls[0][0];
    expect(call.isSimulation).toBeFalsy();
  });

  // ── Multi-iteration: search then respond ────────────────────────────────────

  it("executes SEARCH_DOCUMENTS then RESPOND_EMAIL across two iterations", async () => {
    mockChatCompletion
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: "call-search",
            function: {
              name: "SEARCH_DOCUMENTS",
              arguments: JSON.stringify({ query: "política de reembolso" }),
            },
          },
        ],
        usage: { inputTokens: 150, outputTokens: 30 },
      })
      .mockResolvedValueOnce(makeRespondEmailToolCall("Re: Reembolso", "Segue a política de reembolso..."));

    mockExecuteTool
      .mockResolvedValueOnce("Política: reembolso em até 30 dias")
      .mockResolvedValueOnce("Email enviado");

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-1", "Como funciona o reembolso?", "EMAIL");

    expect(result.responded).toBe(true);
    expect(result.iterations).toBe(2);
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    expect(mockExecuteTool).toHaveBeenNthCalledWith(
      1, "SEARCH_DOCUMENTS", expect.any(Object), expect.any(Object)
    );
    expect(mockExecuteTool).toHaveBeenNthCalledWith(
      2, "RESPOND_EMAIL", expect.any(Object), expect.any(Object)
    );
  });

  // ── Direct text response (no tool calls) ────────────────────────────────────

  it("handles direct text response (no tool calls) by calling RESPOND_EMAIL internally", async () => {
    mockChatCompletion.mockResolvedValue({
      content: "Resposta direta por email",
      tool_calls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-1", "Olá", "EMAIL");

    expect(result.responded).toBe(true);
    // For EMAIL channel, direct text falls through to RESPOND_EMAIL
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "RESPOND_EMAIL",
      expect.objectContaining({ message: "Resposta direta por email" }),
      expect.any(Object)
    );
  });

  // ── ESCALATE path ───────────────────────────────────────────────────────────

  it("returns escalated:true and responded:false when ESCALATE tool is called", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [
        {
          id: "call-esc",
          function: {
            name: "ESCALATE",
            arguments: JSON.stringify({ reason: "Cliente solicitou humano" }),
          },
        },
      ],
      usage: { inputTokens: 80, outputTokens: 20 },
    });
    mockExecuteTool.mockResolvedValue("escalated");

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-1", "Quero falar com um humano", "EMAIL");

    expect(result.escalated).toBe(true);
    expect(result.responded).toBe(false);
    expect(result.error).toBeUndefined();
  });

  // ── Guard: AI disabled ───────────────────────────────────────────────────────

  it("returns error when AI is not enabled", async () => {
    mockAiConfigFindUnique.mockResolvedValue({ ...mockAiConfig, enabled: false });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-1", "Olá", "EMAIL");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("AI not enabled");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("returns error when email channel is disabled", async () => {
    mockAiConfigFindUnique.mockResolvedValue({ ...mockAiConfig, emailEnabled: false });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-1", "Email", "EMAIL");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("email_channel_disabled");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Guard: ticket not found ─────────────────────────────────────────────────

  it("returns error when ticket is not found", async () => {
    mockTicketFindUnique.mockResolvedValue(null);

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-nonexistent", "company-1", "Olá", "EMAIL");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("Ticket not found");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Guard: API key decrypt failure ──────────────────────────────────────────

  it("returns error when API key decryption fails", async () => {
    mockDecrypt.mockImplementation(() => { throw new Error("Decryption failed"); });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-1", "Olá", "EMAIL");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("api_key_decrypt_failed");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Guard: daily spend limit ────────────────────────────────────────────────

  it("returns error when daily spend limit is reached", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      dailySpendLimitBrl: 10.0,
    });
    mockGetTodaySpend.mockResolvedValue(10.5); // already over limit

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-1", "Email", "EMAIL");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("daily_spend_limit_reached");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Guard: escalation keyword fast-path ─────────────────────────────────────

  it("escalates via keyword fast-path without calling LLM", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      escalationKeywords: ["cancelar", "reembolso"],
    });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent(
      "ticket-123", "company-1",
      "Quero CANCELAR meu contrato",
      "EMAIL"
    );

    expect(mockChatCompletion).not.toHaveBeenCalled();
    expect(result.escalated).toBe(true);
    expect(result.responded).toBe(false);
    expect(result.iterations).toBe(0);
  });

  // ── AI config not found ─────────────────────────────────────────────────────

  it("returns error when AI config does not exist for company", async () => {
    mockAiConfigFindUnique.mockResolvedValue(null);

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-123", "company-unknown", "Olá", "EMAIL");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("AI not enabled");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Fallback to env config when no apiKey ───────────────────────────────────

  it("falls back to env provider config when no apiKey is set", async () => {
    mockAiConfigFindUnique.mockResolvedValue({ ...mockAiConfig, apiKey: null });
    mockChatCompletion.mockResolvedValue(makeRespondEmailToolCall());

    const { runAgent } = await import("@/lib/ai/agent");
    await runAgent("ticket-123", "company-1", "Sem chave configurada", "EMAIL");

    expect(mockGetEnvProviderConfig).toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockChatCompletion).toHaveBeenCalled();
  });
});
