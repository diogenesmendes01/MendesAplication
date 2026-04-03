/**
 * Unit tests for agent.ts - runAgent and runAgentDryRun.
 * Fixes https://github.com/diogenesmendes01/MendesAplication/issues/230
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChatCompletion = vi.fn();
const mockGetEnvProviderConfig = vi.fn();
const mockExecuteTool = vi.fn();
const mockDecrypt = vi.fn((v: string) => `decrypted:${v}`);
const mockGetTodaySpend = vi.fn().mockResolvedValue(0);
const mockCheckAndReserveSpend = vi.fn().mockResolvedValue(true);
const mockLogUsage = vi.fn().mockResolvedValue(undefined);
const mockGetToolsForChannel = vi.fn().mockReturnValue([]);
const mockGetBrlUsdRateSync = vi.fn().mockReturnValue(5.0);

const mockPrismaAiConfigFindUnique = vi.fn();
const mockPrismaTicketFindUnique = vi.fn();
const mockPrismaTicketUpdate = vi.fn();
const mockPrismaTicketMessageFindMany = vi.fn().mockResolvedValue([]);
const mockPrismaTicketMessageCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiConfig: { findUnique: (...a: unknown[]) => mockPrismaAiConfigFindUnique(...a), findFirst: (...a: unknown[]) => mockPrismaAiConfigFindUnique(...a) },
    ticket: {
      findUnique: (...a: unknown[]) => mockPrismaTicketFindUnique(...a),
      update: (...a: unknown[]) => mockPrismaTicketUpdate(...a),
    },
    ticketMessage: {
      findMany: (...a: unknown[]) => mockPrismaTicketMessageFindMany(...a),
      create: (...a: unknown[]) => mockPrismaTicketMessageCreate(...a),
    },
  },
}));

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
  checkAndReserveSpend: (...args: unknown[]) => mockCheckAndReserveSpend(...args),
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));

vi.mock("@/lib/ai/tools", () => ({
  getToolsForChannel: (...args: unknown[]) => mockGetToolsForChannel(...args),
}));

vi.mock("@/lib/ai/exchange-rate", () => ({
  getBrlUsdRateSync: () => mockGetBrlUsdRateSync(),
  getBrlUsdRate: vi.fn().mockResolvedValue(5.0),
}));

vi.mock("@/lib/ai/pricing", () => ({
  DEFAULT_MODELS: {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    deepseek: "deepseek-chat",
  } as Record<string, string>,
  MODEL_PRICING: {
    "gpt-4o": { input: 2.5, output: 10.0 },
  } as Record<string, { input: number; output: number }>,
  FALLBACK_PRICING: { input: 3.0, output: 15.0 },
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

import { runAgent, runAgentDryRun } from "@/lib/ai/agent";

const baseAiConfig = {
  id: "ai-cfg-1", companyId: "comp-1", enabled: true,
  whatsappEnabled: true, emailEnabled: true,
  provider: "openai", apiKey: "encrypted-key", model: "gpt-4o",
  temperature: 0.7, persona: "Assistente.", emailPersona: null,
  emailSignature: null, maxIterations: 5,
  dailySpendLimitBrl: null, escalationKeywords: [] as string[],
};

const baseTicket = {
  id: "ticket-1", clientId: "client-1",
  client: { id: "client-1", name: "Joao", telefone: "+5511999990000" },
  contact: { id: "contact-1", name: "Joao", whatsapp: "+5511999990000", email: "j@t.com" },
};

function setupDefaults() {
  mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig });
  mockPrismaTicketFindUnique.mockResolvedValue({ ...baseTicket });
  mockPrismaTicketMessageFindMany.mockResolvedValue([]);
  mockDecrypt.mockReturnValue("decrypted-key");
  mockGetTodaySpend.mockResolvedValue(0);
  mockCheckAndReserveSpend.mockResolvedValue(true);
  mockExecuteTool.mockResolvedValue("ok");
  mockChatCompletion.mockResolvedValue({
    content: "Ola!", tool_calls: undefined,
    usage: { inputTokens: 50, outputTokens: 30 },
  });
}

describe("runAgent", () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaults(); });

  it("error when AI not enabled", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, enabled: false });
    const r = await runAgent("t1", "c1", "Ola");
    expect(r).toEqual({ responded: false, escalated: false, iterations: 0, error: "AI not enabled" });
  });

  it("error when aiConfig null", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue(null);
    expect((await runAgent("t1", "c1", "Ola")).error).toBe("AI not enabled");
  });

  it("error when WhatsApp disabled", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, whatsappEnabled: false });
    expect((await runAgent("t1", "c1", "Ola", "WHATSAPP")).error).toBe("whatsapp_channel_disabled");
  });

  it("error when email disabled", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, emailEnabled: false });
    expect((await runAgent("t1", "c1", "Ola", "EMAIL")).error).toBe("email_channel_disabled");
  });

  it("error when daily spend limit reached", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, dailySpendLimitBrl: 10 });
    mockCheckAndReserveSpend.mockResolvedValue(false);
    const r = await runAgent("t1", "c1", "Ola");
    expect(r.error).toBe("daily_spend_limit_reached");
  });

  it("proceeds when spend below limit", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, dailySpendLimitBrl: 100 });
    mockCheckAndReserveSpend.mockResolvedValue(true);
    expect((await runAgent("t1", "c1", "Ola")).responded).toBe(true);
  });

  it("escalates on keyword match", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, escalationKeywords: ["cancelar"] });
    const r = await runAgent("t1", "c1", "Quero CANCELAR");
    expect(r.escalated).toBe(true);
    expect(r.iterations).toBe(0);
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("no escalation without keyword match", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, escalationKeywords: ["cancelar"] });
    const r = await runAgent("t1", "c1", "Horario?");
    expect(r.escalated).toBe(false);
    expect(r.responded).toBe(true);
  });

  it("error on decrypt failure", async () => {
    mockDecrypt.mockImplementation(() => { throw new Error("fail"); });
    expect((await runAgent("t1", "c1", "Ola")).error).toBe("api_key_decrypt_failed");
  });

  it("uses env config when no API key", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, apiKey: null });
    mockGetEnvProviderConfig.mockResolvedValue({ provider: "openai", apiKey: "env-k", model: "gpt-4o" });
    expect((await runAgent("t1", "c1", "Ola")).responded).toBe(true);
    expect(mockGetEnvProviderConfig).toHaveBeenCalled();
  });

  it("error when ticket not found", async () => {
    mockPrismaTicketFindUnique.mockResolvedValue(null);
    expect((await runAgent("t1", "c1", "Ola")).error).toBe("Ticket not found");
  });

  it("error when no phone for WhatsApp", async () => {
    mockPrismaTicketFindUnique.mockResolvedValue({
      ...baseTicket,
      contact: { ...baseTicket.contact, whatsapp: null },
      client: { ...baseTicket.client, telefone: null },
    });
    expect((await runAgent("t1", "c1", "Ola", "WHATSAPP")).error).toBe("No phone number available for reply");
  });

  it("responded=true on text response", async () => {
    const r = await runAgent("t1", "c1", "Ola");
    expect(r.responded).toBe(true);
    expect(r.iterations).toBe(1);
    expect(mockLogUsage).toHaveBeenCalled();
  });

  it("responded=true via RESPOND tool", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "RESPOND", arguments: '{"message":"R"}' } }],
      usage: { inputTokens: 50, outputTokens: 30 },
    });
    expect((await runAgent("t1", "c1", "Ola")).responded).toBe(true);
    expect(mockExecuteTool).toHaveBeenCalledWith("RESPOND", { message: "R" }, expect.any(Object));
  });

  it("escalated=true via ESCALATE tool", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "ESCALATE", arguments: '{"reason":"X"}' } }],
      usage: { inputTokens: 50, outputTokens: 30 },
    });
    const r = await runAgent("t1", "c1", "Ajuda");
    expect(r.escalated).toBe(true);
    expect(r.responded).toBe(false);
  });

  it("error on empty LLM response", async () => {
    mockChatCompletion.mockResolvedValue({ content: null, tool_calls: undefined, usage: { inputTokens: 10, outputTokens: 0 } });
    expect((await runAgent("t1", "c1", "Ola")).error).toBe("empty LLM response");
  });

  it("error when no default model", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, provider: "unknown", model: null });
    mockDecrypt.mockReturnValue("k");
    expect((await runAgent("t1", "c1", "Ola")).error).toContain("no_default_model_for_provider");
  });
});

describe("runAgentDryRun", () => {
  beforeEach(() => { vi.clearAllMocks(); setupDefaults(); });

  it("error when AI not configured", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue(null);
    expect((await runAgentDryRun("c1", "Ola")).error).toBe("AI not configured");
  });

  it("error when AI not enabled", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, enabled: false });
    expect((await runAgentDryRun("c1", "Ola")).error).toBe("AI not enabled");
  });

  it("error when WhatsApp disabled", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, whatsappEnabled: false });
    expect((await runAgentDryRun("c1", "Ola", "WHATSAPP")).error).toBe("whatsapp_channel_disabled");
  });

  it("error when email disabled", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, emailEnabled: false });
    expect((await runAgentDryRun("c1", "Ola", "EMAIL")).error).toBe("email_channel_disabled");
  });

  it("detects escalation keyword", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, escalationKeywords: ["cancelar"] });
    const r = await runAgentDryRun("c1", "Quero cancelar");
    expect(r.response).toContain("cancelar");
    expect(r.estimatedCostBrl).toBe(0);
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("returns response and cost on success", async () => {
    mockChatCompletion.mockResolvedValue({ content: "Sim!", usage: { inputTokens: 100, outputTokens: 50 } });
    const r = await runAgentDryRun("c1", "Preco?");
    expect(r.response).toBe("Sim!");
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(50);
    expect(r.estimatedCostBrl).toBeGreaterThan(0);
  });

  it("RESPOND tool message as response", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "RESPOND", arguments: '{"message":"Ola!"}' } }],
      usage: { inputTokens: 30, outputTokens: 20 },
    });
    expect((await runAgentDryRun("c1", "Oi")).response).toBe("Ola!");
  });

  it("ESCALATE in dry-run", async () => {
    mockChatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "ESCALATE", arguments: '{"reason":"Complexo"}' } }],
      usage: { inputTokens: 30, outputTokens: 20 },
    });
    const r = await runAgentDryRun("c1", "Ajuda");
    expect(r.response).toContain("Escalado");
  });

  it("error on decrypt failure", async () => {
    mockDecrypt.mockImplementation(() => { throw new Error("fail"); });
    expect((await runAgentDryRun("c1", "Ola")).error).toBe("api_key_decrypt_failed");
  });

  it("uses env config when no API key", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, apiKey: null });
    mockGetEnvProviderConfig.mockResolvedValue({ provider: "openai", apiKey: "env-k", model: "gpt-4o" });
    mockChatCompletion.mockResolvedValue({ content: "ok", usage: { inputTokens: 10, outputTokens: 5 } });
    expect((await runAgentDryRun("c1", "Ola")).response).toBe("ok");
  });

  it("logs with isSimulation=true", async () => {
    mockChatCompletion.mockResolvedValue({ content: "t", usage: { inputTokens: 10, outputTokens: 5 } });
    await runAgentDryRun("c1", "Ola");
    expect(mockLogUsage).toHaveBeenCalledWith(expect.objectContaining({ isSimulation: true }));
  });

  it("error when no default model", async () => {
    mockPrismaAiConfigFindUnique.mockResolvedValue({ ...baseAiConfig, provider: "unknown", model: null });
    mockDecrypt.mockReturnValue("k");
    expect((await runAgentDryRun("c1", "Ola")).error).toContain("no_default_model_for_provider");
  });
});

// ─── enabledTools per channel (feat/ai-config-enabled-tools) ──────────────────

describe("runAgent — enabledTools filter passed to getToolsForChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecrypt.mockImplementation((v: string) => `decrypted:${v}`);
    mockGetBrlUsdRateSync.mockReturnValue(5.0);
    mockGetTodaySpend.mockResolvedValue(0);
    mockCheckAndReserveSpend.mockResolvedValue(true);
    mockLogUsage.mockResolvedValue(undefined);
    mockPrismaTicketMessageFindMany.mockResolvedValue([]);
    mockPrismaTicketMessageCreate.mockResolvedValue({});
    mockPrismaTicketUpdate.mockResolvedValue({});
    mockGetEnvProviderConfig.mockReturnValue(null);
    mockChatCompletion.mockResolvedValue({ content: "ok", usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it("passes whatsappEnabledTools to getToolsForChannel for WHATSAPP channel", async () => {
    const enabledTools = ["SEARCH_DOCUMENTS", "GET_CLIENT_INFO"];
    mockPrismaAiConfigFindUnique.mockResolvedValue({
      ...baseAiConfig,
      whatsappEnabled: true,
      whatsappEnabledTools: enabledTools,
      emailEnabledTools: [],
      raEnabledTools: [],
    });
    mockPrismaTicketFindUnique.mockResolvedValue({
      ...baseTicket,
      channel: { type: "WHATSAPP" },
    });
    await runAgent("ticket-1", "oi");
    expect(mockGetToolsForChannel).toHaveBeenCalledWith("WHATSAPP", enabledTools);
  });

  it("passes raEnabledTools to getToolsForChannel for RECLAMEAQUI channel", async () => {
    const enabledTools = ["SEARCH_DOCUMENTS"];
    mockPrismaAiConfigFindUnique.mockResolvedValue({
      ...baseAiConfig,
      raEnabled: true,
      whatsappEnabledTools: [],
      emailEnabledTools: [],
      raEnabledTools: enabledTools,
    });
    mockPrismaTicketFindUnique.mockResolvedValue({
      ...baseTicket,
      channel: { type: "RECLAMEAQUI" },
    });
    await runAgent("ticket-1", "reclamação");
    expect(mockGetToolsForChannel).toHaveBeenCalledWith("RECLAMEAQUI", enabledTools);
  });

  it("passes empty array when enabledTools fields are absent (backward compat)", async () => {
    // Config without the new fields (old record)
    mockPrismaAiConfigFindUnique.mockResolvedValue({
      ...baseAiConfig,
      whatsappEnabled: true,
      // no whatsappEnabledTools field
    });
    mockPrismaTicketFindUnique.mockResolvedValue({
      ...baseTicket,
      channel: { type: "WHATSAPP" },
    });
    await runAgent("ticket-1", "oi");
    expect(mockGetToolsForChannel).toHaveBeenCalledWith("WHATSAPP", []);
  });
});
