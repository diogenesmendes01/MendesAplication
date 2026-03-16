/**
 * Tests for runAgent — production path.
 *
 * Covers WARN #2 from QA review (PR #71):
 *   - Canal desabilitado (whatsappEnabled / emailEnabled)
 *   - Limite diário atingido
 *   - Decrypt failure
 *   - Escalação por keyword (fast-path antes do LLM)
 *   - AI not enabled / config not found
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockChatCompletion = vi.fn();
const mockGetEnvProviderConfig = vi.fn();
const mockExecuteTool = vi.fn();
const mockDecrypt = vi.fn((v: string) => `decrypted:${v}`);
const mockGetTodaySpend = vi.fn().mockResolvedValue(0);
const mockLogUsage = vi.fn().mockResolvedValue(undefined);

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

// Base AI config
const mockAiConfig = {
  id: "config-1",
  companyId: "company-1",
  enabled: true,
  persona: "Assistente de testes",
  welcomeMessage: "Olá!",
  escalationKeywords: [],
  maxIterations: 3,
  provider: "openai",
  apiKey: "encrypted-key",
  model: "gpt-4o",
  whatsappEnabled: true,
  emailEnabled: true,
  emailPersona: "Email persona",
  emailSignature: "Atenciosamente,\nEquipe",
  dailySpendLimitBrl: null,
  temperature: 0.7,
};

// Base ticket
const mockTicket = {
  id: "ticket-1",
  clientId: "client-1",
  subject: "Problema de teste",
  status: "OPEN",
  aiEnabled: true,
  contact: { id: "contact-1", name: "João Silva", whatsapp: "5511999999999", email: "joao@example.com" },
  client: { id: "client-1", name: "Empresa Teste", telefone: "5511888888888" },
};

const mockAiConfigFindUnique = vi.fn();
const mockTicketFindUnique = vi.fn();
const mockTicketUpdate = vi.fn().mockResolvedValue({});
const mockTicketMessageCreate = vi.fn().mockResolvedValue({ id: "msg-1" });
const mockTicketMessageFindMany = vi.fn().mockResolvedValue([]);

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
      create: (...args: unknown[]) => mockTicketMessageCreate(...args),
      findMany: (...args: unknown[]) => mockTicketMessageFindMany(...args),
    },
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runAgent — production path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAiConfigFindUnique.mockResolvedValue(mockAiConfig);
    mockTicketFindUnique.mockResolvedValue(mockTicket);
    mockGetEnvProviderConfig.mockResolvedValue({
      provider: "openai",
      apiKey: "env-key",
      model: "gpt-4o",
    });
    mockDecrypt.mockImplementation((v: string) => `decrypted:${v}`);
    mockGetTodaySpend.mockResolvedValue(0);
  });

  // ── AI not configured / not enabled ─────────────────────────────────────

  it("returns error when aiConfig is not found", async () => {
    mockAiConfigFindUnique.mockResolvedValue(null);

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-1", "company-1", "Olá", "WHATSAPP");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("AI not enabled");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("returns error when AI is disabled in config", async () => {
    mockAiConfigFindUnique.mockResolvedValue({ ...mockAiConfig, enabled: false });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-1", "company-1", "Olá", "WHATSAPP");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("AI not enabled");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Canal desabilitado ───────────────────────────────────────────────────

  it("returns error when whatsapp channel is disabled", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      whatsappEnabled: false,
    });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-1", "company-1", "Olá", "WHATSAPP");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("whatsapp_channel_disabled");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("returns error when email channel is disabled", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      emailEnabled: false,
    });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-1", "company-1", "Problema por email", "EMAIL");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("email_channel_disabled");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Limite diário ────────────────────────────────────────────────────────

  it("returns error when daily spend limit is reached", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      dailySpendLimitBrl: 10.0,
    });
    mockGetTodaySpend.mockResolvedValue(10.5); // over the limit

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-1", "company-1", "Olá", "WHATSAPP");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("daily_spend_limit_reached");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("proceeds normally when spend is below the daily limit", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      dailySpendLimitBrl: 50.0,
    });
    mockGetTodaySpend.mockResolvedValue(5.0); // well under the limit
    mockChatCompletion.mockResolvedValue({
      content: "Posso ajudar!",
      tool_calls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockExecuteTool.mockResolvedValue("sent");

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-1", "company-1", "Oi", "WHATSAPP");

    expect(result.responded).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // ── Decrypt failure ──────────────────────────────────────────────────────

  it("returns error when apiKey decrypt fails", async () => {
    mockDecrypt.mockImplementation(() => {
      throw new Error("Decryption failed: invalid key material");
    });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-1", "company-1", "Olá", "WHATSAPP");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("api_key_decrypt_failed");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Escalação por keyword ────────────────────────────────────────────────

  it("escalates immediately on keyword match without calling LLM", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      escalationKeywords: ["urgente", "cancelar", "reembolso"],
    });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent(
      "ticket-1",
      "company-1",
      "Quero cancelar minha assinatura imediatamente",
      "WHATSAPP"
    );

    expect(result.escalated).toBe(true);
    expect(result.responded).toBe(false);
    expect(result.iterations).toBe(0);
    expect(mockChatCompletion).not.toHaveBeenCalled();

    // Should update the ticket
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ticket-1" },
        data: expect.objectContaining({ aiEnabled: false, status: "OPEN" }),
      })
    );

    // Should create internal escalation note
    expect(mockTicketMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketId: "ticket-1",
          isInternal: true,
          isAiGenerated: true,
        }),
      })
    );
  });

  it("does NOT escalate when keyword does not match", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      escalationKeywords: ["cancelar", "reembolso"],
    });
    mockChatCompletion.mockResolvedValue({
      content: "Posso ajudar!",
      tool_calls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockExecuteTool.mockResolvedValue("sent");

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent(
      "ticket-1",
      "company-1",
      "Preciso de ajuda com meu pedido",
      "WHATSAPP"
    );

    expect(result.escalated).toBe(false);
    expect(mockChatCompletion).toHaveBeenCalled();
  });

  it("keyword match is case-insensitive", async () => {
    mockAiConfigFindUnique.mockResolvedValue({
      ...mockAiConfig,
      escalationKeywords: ["reembolso"],
    });

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent(
      "ticket-1",
      "company-1",
      "Quero meu REEMBOLSO agora!",
      "WHATSAPP"
    );

    expect(result.escalated).toBe(true);
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── Ticket not found ─────────────────────────────────────────────────────

  it("returns error when ticket is not found in DB", async () => {
    mockTicketFindUnique.mockResolvedValue(null);

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("nonexistent-ticket", "company-1", "Olá", "WHATSAPP");

    expect(result.responded).toBe(false);
    expect(result.error).toBe("Ticket not found");
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  // ── logUsage is called in production mode ────────────────────────────────

  it("calls logUsage with correct params after successful LLM call", async () => {
    mockChatCompletion.mockResolvedValue({
      content: "Tudo certo!",
      tool_calls: [],
      usage: { inputTokens: 200, outputTokens: 80 },
    });
    mockExecuteTool.mockResolvedValue("sent");

    const { runAgent } = await import("@/lib/ai/agent");
    await runAgent("ticket-1", "company-1", "Oi", "WHATSAPP");

    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        provider: "openai",
        inputTokens: 200,
        outputTokens: 80,
        ticketId: "ticket-1",
        channel: "WHATSAPP",
      })
    );
  });

  // ── Happy path: RESPOND tool called ─────────────────────────────────────

  it("returns responded=true when RESPOND tool is executed", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "RESPOND",
            arguments: JSON.stringify({ message: "Olá! Posso ajudar." }),
          },
        },
      ],
      usage: { inputTokens: 150, outputTokens: 60 },
    });
    mockExecuteTool.mockResolvedValue("Mensagem enviada ao cliente com sucesso.");

    const { runAgent } = await import("@/lib/ai/agent");
    const result = await runAgent("ticket-1", "company-1", "Oi", "WHATSAPP");

    expect(result.responded).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.iterations).toBe(1);
  });
});
