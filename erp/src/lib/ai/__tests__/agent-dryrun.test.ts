import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockChatCompletion = vi.fn();
const mockGetEnvProviderConfig = vi.fn();
const mockExecuteTool = vi.fn();
const mockDecrypt = vi.fn((v: string) => `decrypted:${v}`);

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
  getTodaySpend: vi.fn().mockResolvedValue(0),
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/tools", () => ({
  getToolsForChannel: vi.fn().mockReturnValue([]),
}));

// Base AI config used in tests
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

const mockFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiConfig: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    ticketMessage: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ticket: {
      findUnique: vi.fn(),
    },
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runAgentDryRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(mockAiConfig);
    mockGetEnvProviderConfig.mockResolvedValue({
      provider: "openai",
      apiKey: "env-key",
      model: "gpt-4o",
    });
  });

  it("returns error when AI config is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-x", "Olá", "WHATSAPP");

    expect(result.error).toBe("AI not configured");
    expect(result.response).toBe("");
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("returns the RESPOND tool message as dry-run response", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [
        {
          id: "call-1",
          function: {
            name: "RESPOND",
            arguments: JSON.stringify({ message: "Olá, posso ajudar!" }),
          },
        },
      ],
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockExecuteTool.mockResolvedValue("ok");

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Oi", "WHATSAPP");

    expect(result.response).toBe("Olá, posso ajudar!");
    expect(result.error).toBeUndefined();
  });

  it("accumulates token usage across multiple iterations", async () => {
    // First iteration: non-terminal tool call
    mockChatCompletion
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: "call-search",
            function: {
              name: "SEARCH_DOCUMENTS",
              arguments: JSON.stringify({ query: "produtos" }),
            },
          },
        ],
        usage: { inputTokens: 200, outputTokens: 30 },
      })
      // Second iteration: RESPOND
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: "call-respond",
            function: {
              name: "RESPOND",
              arguments: JSON.stringify({ message: "Encontrei o produto!" }),
            },
          },
        ],
        usage: { inputTokens: 300, outputTokens: 80 },
      });

    mockExecuteTool.mockResolvedValue("resultado da busca");

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Quais produtos vocês têm?", "WHATSAPP");

    expect(result.inputTokens).toBe(500);   // 200 + 300
    expect(result.outputTokens).toBe(110);  // 30 + 80
    expect(result.response).toBe("Encontrei o produto!");
  });

  it("returns escalated response when ESCALATE tool is called", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [
        {
          id: "call-esc",
          function: {
            name: "ESCALATE",
            arguments: JSON.stringify({ reason: "Problema complexo" }),
          },
        },
      ],
      usage: { inputTokens: 150, outputTokens: 40 },
    });
    mockExecuteTool.mockResolvedValue("escalated");

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Preciso de ajuda urgente", "WHATSAPP");

    expect(result.response).toContain("Escalado");
    expect(result.response).toContain("Problema complexo");
  });

  it("returns direct text response when LLM skips tool calls", async () => {
    mockChatCompletion.mockResolvedValue({
      content: "Resposta direta sem tool call",
      tool_calls: [],
      usage: { inputTokens: 80, outputTokens: 60 },
    });

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Olá", "WHATSAPP");

    expect(result.response).toBe("Resposta direta sem tool call");
    expect(result.inputTokens).toBe(80);
  });

  it("calls logUsage in dry-run mode so tokens are tracked in Consumo and against the daily limit", async () => {
    const { logUsage } = await import("@/lib/ai/cost-tracker");
    mockChatCompletion.mockResolvedValue({
      content: "Oi",
      tool_calls: [],
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    await runAgentDryRun("company-1", "Oi", "WHATSAPP");

    expect(logUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        aiConfigId: expect.any(String),
        companyId: "company-1",
        channel: "WHATSAPP",
        inputTokens: 50,
        outputTokens: 20,
      }),
    );
  });

  it("returns estimatedCostBrl > 0 when tokens are consumed", async () => {
    mockChatCompletion.mockResolvedValue({
      content: "Ok",
      tool_calls: [],
      usage: { inputTokens: 1000, outputTokens: 500 },
    });

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Teste", "WHATSAPP");

    expect(result.estimatedCostBrl).toBeGreaterThan(0);
  });

  it("uses EMAIL RESPOND_EMAIL tool for email channel", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [
        {
          id: "call-email",
          function: {
            name: "RESPOND_EMAIL",
            arguments: JSON.stringify({ subject: "Re: Suporte", message: "Resposta por email" }),
          },
        },
      ],
      usage: { inputTokens: 200, outputTokens: 100 },
    });
    mockExecuteTool.mockResolvedValue("sent");

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Problema por email", "EMAIL");

    expect(result.response).toBe("Resposta por email");
  });

  // ── WARN #1 fix: aiConfig.enabled and channel guards must apply in dry-run ──

  it("returns error when aiConfig.enabled is false", async () => {
    mockFindUnique.mockResolvedValue({ ...mockAiConfig, enabled: false });

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Olá", "WHATSAPP");

    expect(result.error).toBe("AI not enabled");
    expect(result.response).toBe("");
    expect(result.estimatedCostBrl).toBe(0);
  });

  it("returns error when emailEnabled is false and channel is EMAIL", async () => {
    mockFindUnique.mockResolvedValue({ ...mockAiConfig, emailEnabled: false });

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Email test", "EMAIL");

    expect(result.error).toBe("email_channel_disabled");
    expect(result.response).toBe("");
  });

  it("returns error when whatsappEnabled is false and channel is WHATSAPP", async () => {
    mockFindUnique.mockResolvedValue({ ...mockAiConfig, whatsappEnabled: false });

    const { runAgentDryRun } = await import("@/lib/ai/agent");
    const result = await runAgentDryRun("company-1", "Oi", "WHATSAPP");

    expect(result.error).toBe("whatsapp_channel_disabled");
    expect(result.response).toBe("");
  });
});
