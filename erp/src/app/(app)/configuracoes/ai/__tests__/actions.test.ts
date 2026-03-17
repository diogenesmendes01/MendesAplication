/**
 * Unit tests for AI config server actions (WARN #5 fix).
 * Covers: testAiConnection — the critical path exercised most in production.
 *         updateAiConfig — encryption, masked-key preservation, validation (WARN-3 fix).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAdmin = vi.fn().mockResolvedValue(undefined);
const mockRequireCompanyAccess = vi.fn().mockResolvedValue(undefined);
const mockChatCompletion = vi.fn();
const mockDecrypt = vi.fn((v: string) => `decrypted:${v}`);
const mockFindUnique = vi.fn();
const mockEncrypt = vi.fn((v: string) => `encrypted:${v}`);
const mockUpsert = vi.fn().mockResolvedValue({});

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
  encrypt: (v: string) => mockEncrypt(v),
  decrypt: (v: string) => mockDecrypt(v),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiConfig: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
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

  // ── WARN-5 fix: providerOverride must be validated against VALID_PROVIDERS ──

  it("throws when providerOverride is not a valid provider", async () => {
    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    await expect(
      listAvailableModels("company-models-8", "invalid-provider")
    ).rejects.toThrow("provider must be one of:");
  });

  it("accepts a valid providerOverride and returns HARDCODED_MODELS", async () => {
    const { listAvailableModels } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await listAvailableModels("company-models-9", "anthropic");

    expect(result).toContain("claude-sonnet-4-20250514");
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});

// ─── updateAiConfig ───────────────────────────────────────────────────────────

describe("updateAiConfig", () => {
  const validData = {
    enabled: true,
    persona: "Assistente de vendas",
    welcomeMessage: "Olá! Como posso ajudar?",
    escalationKeywords: ["humano", "atendente"],
    maxIterations: 5,
    provider: "openai",
    apiKey: "sk-test-newkey-1234567890",
    model: "gpt-4o",
    temperature: 0.7,
    dailySpendLimitBrl: null,
    whatsappEnabled: true,
    emailEnabled: false,
    emailPersona: null,
    emailSignature: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({ userId: "user-1", role: "ADMIN" });
    mockRequireCompanyAccess.mockResolvedValue(undefined);
    mockFindUnique.mockResolvedValue(baseConfig);
    mockEncrypt.mockImplementation((v: string) => `encrypted:${v}`);
    mockUpsert.mockResolvedValue({});
  });

  it("encrypts new API key — encrypt() called with plain key and upsert receives encrypted value", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    const plainKey = "sk-test-brand-new-key-abc123";
    await updateAiConfig("company-enc", { ...validData, apiKey: plainKey });

    // encrypt() must have been called with the plain key
    expect(mockEncrypt).toHaveBeenCalledWith(plainKey);

    // upsert must have been called with the encrypted value in the create path
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ apiKey: `encrypted:${plainKey}` }),
        update: expect.objectContaining({ apiKey: `encrypted:${plainKey}` }),
      })
    );
  });

  it("preserves existing API key when masked value (****) is submitted", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    // Submit the masked value that maskApiKey() returns
    await updateAiConfig("company-masked", { ...validData, apiKey: "****" });

    // encrypt() must NOT have been called — masked key means "keep existing"
    expect(mockEncrypt).not.toHaveBeenCalled();

    // The upsert update payload must NOT include apiKey (preserves existing DB value)
    const upsertCall = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    const updatePayload = upsertCall.update as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty("apiKey");
  });

  it("also preserves key when empty string is submitted (no masked pattern match needed)", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    await updateAiConfig("company-empty-key", { ...validData, apiKey: "" });

    // Empty string → keep-existing (same as masked key); explicit removal requires null.
    // The upsert update payload must NOT include apiKey (preserves existing DB value).
    expect(mockEncrypt).not.toHaveBeenCalled();
    const upsertCall = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    const updatePayload = upsertCall.update as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty("apiKey");
  });

  it("throws when temperature is out of range (> 1)", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    await expect(
      updateAiConfig("company-1", { ...validData, temperature: 1.5 })
    ).rejects.toThrow(/temperature must be a number between 0 and 1/i);
  });

  it("throws when temperature is negative", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    await expect(
      updateAiConfig("company-1", { ...validData, temperature: -0.1 })
    ).rejects.toThrow(/temperature must be a number between 0 and 1/i);
  });

  it("throws when provider is not in the allowed list", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    await expect(
      updateAiConfig("company-1", { ...validData, provider: "evil-provider" })
    ).rejects.toThrow(/provider must be one of/i);
  });

  it("throws when apiKey is too short (< 8 chars)", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    await expect(
      updateAiConfig("company-1", { ...validData, apiKey: "short" })
    ).rejects.toThrow(/apiKey too short/i);
  });

  // ── hint save/clear coverage (QA WARN #3 — issue #242) ───────────────────

  it("saves apiKeyHint = last 4 chars of plain key when a new key is provided", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    const plainKey = "sk-test-brand-new-key-ABCD";
    await updateAiConfig("company-hint-save", { ...validData, apiKey: plainKey });

    const upsertCall = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    const updatePayload = upsertCall.update as Record<string, unknown>;
    const createPayload = upsertCall.create as Record<string, unknown>;

    // hint must be the last 4 characters of the plain key
    expect(updatePayload.apiKeyHint).toBe("ABCD");
    expect(createPayload.apiKeyHint).toBe("ABCD");
  });

  it("zeros apiKeyHint = null when apiKey is explicitly removed (null)", async () => {
    const { updateAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );

    // Simulate explicit key removal (e.g. a "remove API key" action in the UI)
    await updateAiConfig("company-hint-clear", {
      ...validData,
      apiKey: null as unknown as string,
    });

    const upsertCall = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    const updatePayload = upsertCall.update as Record<string, unknown>;
    const createPayload = upsertCall.create as Record<string, unknown>;

    // Both the key and the hint must be zeroed to avoid stale display
    expect(updatePayload.apiKey).toBeNull();
    expect(updatePayload.apiKeyHint).toBeNull();
    expect(createPayload.apiKey).toBeNull();
    expect(createPayload.apiKeyHint).toBeNull();
  });
});

// ─── getAiConfig — apiKeyHint coverage (QA WARN #3 — issue #242) ─────────────

describe("getAiConfig — apiKeyHint masking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCompanyAccess.mockResolvedValue(undefined);
  });

  it("returns ****XXXX when apiKeyHint is populated (user-friendly key display)", async () => {
    mockFindUnique.mockResolvedValue({
      ...baseConfig,
      apiKey: "encrypted-key",
      apiKeyHint: "ABCD",
    });

    const { getAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await getAiConfig("company-hint-display");

    // maskApiKey(encryptedKey, "ABCD") → "****ABCD"
    expect(result.apiKey).toBe("****ABCD");
  });

  it("returns '' (empty string) when key is null but hint is stale — maskApiKey(null, hint)", async () => {
    // Edge case: key was deleted but hint column still has a value (data inconsistency)
    mockFindUnique.mockResolvedValue({
      ...baseConfig,
      apiKey: null,
      apiKeyHint: "ABCD",
    });

    const { getAiConfig } = await import(
      "@/app/(app)/configuracoes/ai/actions"
    );
    const result = await getAiConfig("company-hint-stale");

    // maskApiKey(null, "ABCD") → "" — no key means nothing to mask, hint is irrelevant
    expect(result.apiKey).toBe("");
  });
});
