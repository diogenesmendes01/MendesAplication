/**
 * Unit tests for AI config server actions (WARN #5 fix).
 * Covers: testAiConnection — the critical path exercised most in production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAdmin = vi.fn().mockResolvedValue(undefined);
const mockRequireCompanyAccess = vi.fn().mockResolvedValue(undefined);
const mockChatCompletion = vi.fn();
const mockDecrypt = vi.fn((v: string) => `decrypted:${v}`);
const mockFindUnique = vi.fn();

vi.mock("@/lib/session", () => ({
  requireAdmin: () => mockRequireAdmin(),
  requireSession: () => mockRequireAdmin(),
  getSession: vi.fn().mockResolvedValue({ userId: "user-1", role: "ADMIN" }),
}));

vi.mock("@/lib/rbac", () => ({
  requireCompanyAccess: (...args: unknown[]) => mockRequireCompanyAccess(...args),
}));

vi.mock("@/lib/ai/provider", () => ({
  chatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
  getEnvProviderConfig: vi.fn(),
}));

vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `encrypted:${v}`,
  decrypt: (v: string) => mockDecrypt(v),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiConfig: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: vi.fn().mockResolvedValue({}),
    },
    aiUsageLog: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/queue", () => ({
  emailOutboundQueue: { add: vi.fn().mockResolvedValue(undefined) },
  aiAgentQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

// ─── Base config fixture ───────────────────────────────────────────────────────

const baseConfig = {
  id: "cfg-1",
  companyId: "company-1",
  enabled: true,
  provider: "openai",
  apiKey: "encrypted-key",
  model: "gpt-4o",
  temperature: 0.7,
  maxIterations: 5,
  dailySpendLimitBrl: null,
  persona: "Assistente",
  welcomeMessage: "Olá!",
  escalationKeywords: [],
  whatsappEnabled: true,
  emailEnabled: false,
  emailPersona: null,
  emailSignature: null,
};

// ─── testAiConnection ─────────────────────────────────────────────────────────

describe("testAiConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset any custom implementations set in individual tests (clearAllMocks doesn't do this)
    mockDecrypt.mockImplementation((v: string) => `decrypted:${v}`);
    mockRequireAdmin.mockResolvedValue(undefined);
    mockRequireCompanyAccess.mockResolvedValue(undefined);
    mockFindUnique.mockResolvedValue(baseConfig);
    mockChatCompletion.mockResolvedValue({
      content: "OK",
      tool_calls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
  });

  it("returns ok:true when chatCompletion succeeds", async () => {
    const { testAiConnection } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await testAiConnection("company-1");

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns ok:false when apiKey is not configured", async () => {
    mockFindUnique.mockResolvedValue({ ...baseConfig, apiKey: null });

    const { testAiConnection } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await testAiConnection("company-1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/api key/i);
  });

  it("returns ok:false when config is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { testAiConnection } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await testAiConnection("company-1");

    expect(result.ok).toBe(false);
  });

  it("returns ok:false with mapped pt-BR message when chatCompletion throws invalid key error", async () => {
    mockChatCompletion.mockRejectedValue(new Error("Invalid API key"));

    const { testAiConnection } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await testAiConnection("company-1");

    expect(result.ok).toBe(false);
    // The action maps raw provider errors to safe pt-BR messages for the frontend
    expect(result.error).toMatch(/api key inválida|sem permissão/i);
  });

  it("returns ok:false when decrypt fails", async () => {
    mockDecrypt.mockImplementation(() => {
      throw new Error("decrypt error");
    });

    const { testAiConnection } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await testAiConnection("company-1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/descriptografar/i);
  });

  it("calls chatCompletion with decrypted key and correct provider", async () => {
    // Use a distinct companyId to avoid the in-memory rate limit (max 5/min per company)
    mockFindUnique.mockResolvedValue({ ...baseConfig, companyId: "company-ratelimit-test" });

    const { testAiConnection } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    await testAiConnection("company-ratelimit-test");

    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      expect.objectContaining({
        provider: "openai",
        apiKey: "decrypted:encrypted-key",
        maxTokens: 5,
      })
    );
  });
});

// ─── listAvailableModels ──────────────────────────────────────────────────────

describe("listAvailableModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecrypt.mockImplementation((v: string) => `decrypted:${v}`);
    mockRequireAdmin.mockResolvedValue(undefined);
    mockRequireCompanyAccess.mockResolvedValue(undefined);
    mockFindUnique.mockResolvedValue(baseConfig);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns HARDCODED_MODELS for anthropic provider (no HTTP call)", async () => {
    mockFindUnique.mockResolvedValue({ ...baseConfig, provider: "anthropic" });
    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await listAvailableModels("company-models-1");

    expect(result).toContain("claude-sonnet-4-20250514");
    expect(result.length).toBeGreaterThan(0);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("returns HARDCODED_MODELS for deepseek provider", async () => {
    mockFindUnique.mockResolvedValue({ ...baseConfig, provider: "deepseek" });
    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await listAvailableModels("company-models-2");

    expect(result).toContain("deepseek-chat");
    expect(result).toContain("deepseek-reasoner");
  });

  it("returns fallback list when openai apiKey is not configured", async () => {
    mockFindUnique.mockResolvedValue({ ...baseConfig, provider: "openai", apiKey: null });
    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await listAvailableModels("company-models-3");

    expect(result).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("returns fallback list when decrypt fails", async () => {
    mockDecrypt.mockImplementation(() => {
      throw new Error("decrypt error");
    });
    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await listAvailableModels("company-models-4");

    expect(result).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("returns filtered gpt- model list from OpenAI API on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { id: "gpt-4o" },
              { id: "gpt-4o-mini" },
              { id: "gpt-4-turbo" },
              { id: "gpt-3.5-turbo-instruct" }, // filtered: contains "instruct"
              { id: "gpt-4-realtime-preview" },  // filtered: contains "realtime"
              { id: "gpt-4-audio-preview" },      // filtered: contains "audio"
              { id: "davinci-002" },              // filtered: no gpt- prefix
            ],
          }),
      }),
    );

    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await listAvailableModels("company-models-5");

    expect(result).toContain("gpt-4o");
    expect(result).toContain("gpt-4o-mini");
    expect(result).toContain("gpt-4-turbo");
    expect(result).not.toContain("gpt-3.5-turbo-instruct");
    expect(result).not.toContain("gpt-4-realtime-preview");
    expect(result).not.toContain("gpt-4-audio-preview");
    expect(result).not.toContain("davinci-002");
  });

  it("returns fallback list when OpenAI API returns non-ok response (401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await listAvailableModels("company-models-6");

    expect(result).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("returns fallback list on fetch abort (AbortController timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new DOMException("The operation was aborted.", "AbortError"),
      ),
    );
    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await listAvailableModels("company-models-7");

    expect(result).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });
});
