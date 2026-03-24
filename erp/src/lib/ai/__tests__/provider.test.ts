/**
 * Unit tests for provider.ts - AI provider abstraction layer.
 * Fixes https://github.com/diogenesmendes01/MendesAplication/issues/230
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/ai/pricing", () => ({
  DEFAULT_MODELS: {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    deepseek: "deepseek-chat",
    grok: "grok-2",
    qwen: "qwen-max",
  } as Record<string, string>,
}));

import {
  isGlobalFallbackBlocked,
  getEnvProviderConfig,
  chatCompletion,
  type ProviderConfig,
  type AiMessage,
  type AiToolDefinition,
} from "@/lib/ai/provider";

function makeOpenAiResponse(content: string | null, toolCalls?: unknown[]) {
  return {
    ok: true, status: 200,
    json: async () => ({
      choices: [{ message: { content, tool_calls: toolCalls } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
    text: async () => "",
  };
}

function makeAnthropicResponse(blocks: unknown[]) {
  return {
    ok: true, status: 200,
    json: async () => ({ content: blocks, usage: { input_tokens: 15, output_tokens: 25 } }),
    text: async () => "",
  };
}

describe("isGlobalFallbackBlocked", () => {
  const orig = process.env;
  afterEach(() => { process.env = { ...orig }; });

  it.each(["true", "1", "yes", "TRUE", " True "])('returns true for "%s"', (v) => {
    process.env.BLOCK_GLOBAL_AI_FALLBACK = v;
    expect(isGlobalFallbackBlocked()).toBe(true);
  });

  it.each(["false", "0", "no", ""])('returns false for "%s"', (v) => {
    process.env.BLOCK_GLOBAL_AI_FALLBACK = v;
    expect(isGlobalFallbackBlocked()).toBe(false);
  });

  it("returns false when unset", () => {
    delete process.env.BLOCK_GLOBAL_AI_FALLBACK;
    expect(isGlobalFallbackBlocked()).toBe(false);
  });
});

describe("getEnvProviderConfig", () => {
  const orig = process.env;
  beforeEach(() => {
    process.env = { ...orig };
    delete process.env.BLOCK_GLOBAL_AI_FALLBACK;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
  });
  afterEach(() => { process.env = { ...orig }; });

  it("returns config from env vars", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.AI_API_KEY = "sk-test-123";
    process.env.AI_MODEL = "deepseek-chat";
    const c = await getEnvProviderConfig();
    expect(c).toEqual({ provider: "deepseek", apiKey: "sk-test-123", model: "deepseek-chat" });
  });

  it("defaults provider to openai", async () => {
    process.env.AI_API_KEY = "sk-test";
    expect((await getEnvProviderConfig()).provider).toBe("openai");
  });

  it("throws when AI_API_KEY missing", async () => {
    await expect(getEnvProviderConfig()).rejects.toThrow("AI_API_KEY environment variable is not set");
  });

  it("throws when fallback blocked", async () => {
    process.env.BLOCK_GLOBAL_AI_FALLBACK = "true";
    process.env.AI_API_KEY = "sk-test";
    await expect(getEnvProviderConfig()).rejects.toThrow(/Global AI env fallback is blocked/);
  });

  it("omits model when AI_MODEL unset", async () => {
    process.env.AI_API_KEY = "sk-test";
    expect((await getEnvProviderConfig()).model).toBeUndefined();
  });
});

describe("chatCompletion - routing", () => {
  beforeEach(() => { mockFetch.mockReset(); });
  const msgs: AiMessage[] = [{ role: "user", content: "Hello" }];

  it("throws for unsupported provider", async () => {
    await expect(chatCompletion(msgs, undefined, { provider: "unknown", apiKey: "k" }))
      .rejects.toThrow("Provedor AI nao suportado: unknown");
  });

  it.each(["openai", "deepseek", "grok", "qwen"])("routes %s to OpenAI-compat", async (p) => {
    mockFetch.mockResolvedValueOnce(makeOpenAiResponse("Hi"));
    const r = await chatCompletion(msgs, undefined, { provider: p, apiKey: "k" });
    expect(r.content).toBe("Hi");
    expect(mockFetch.mock.calls[0][0]).toContain("/v1/chat/completions");
  });

  it("routes anthropic correctly", async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: "text", text: "Bonjour" }]));
    const r = await chatCompletion(msgs, undefined, { provider: "anthropic", apiKey: "k" });
    expect(r.content).toBe("Bonjour");
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
  });
});

describe("OpenAI-compatible completion", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("sends correct headers and body", async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAiResponse("ok"));
    await chatCompletion([{ role: "user", content: "test" }], undefined,
      { provider: "openai", apiKey: "sk-abc", model: "gpt-4o", temperature: 0.5, maxTokens: 100 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer sk-abc");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("gpt-4o");
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
  });

  it("includes tools in request", async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAiResponse("done"));
    const tools: AiToolDefinition[] = [{ name: "SEARCH", description: "Search", parameters: { type: "object", properties: {}, required: [] as const } }];
    await chatCompletion([{ role: "user", content: "find" }], tools, { provider: "openai", apiKey: "k" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe("SEARCH");
  });

  it("maps tool_calls from response", async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAiResponse(null, [
      { id: "c1", function: { name: "RESPOND", arguments: '{"message":"hi"}' } },
    ]));
    const r = await chatCompletion([{ role: "user", content: "x" }], [], { provider: "openai", apiKey: "k" });
    expect(r.tool_calls).toHaveLength(1);
    expect(r.tool_calls![0].function.name).toBe("RESPOND");
  });

  it("maps usage", async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAiResponse("ok"));
    const r = await chatCompletion([{ role: "user", content: "t" }], undefined, { provider: "openai", apiKey: "k" });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("throws on API error with redacted body", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "bad" });
    await expect(chatCompletion([{ role: "user", content: "t" }], undefined, { provider: "openai", apiKey: "k" }))
      .rejects.toThrow(/openai API error 401.*redacted/);
  });

  it("throws on empty choices", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [] }), text: async () => "" });
    await expect(chatCompletion([{ role: "user", content: "t" }], undefined, { provider: "openai", apiKey: "k" }))
      .rejects.toThrow(/resposta vazia/);
  });
});

describe("Anthropic completion", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("extracts system prompt", async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: "text", text: "r" }]));
    await chatCompletion([{ role: "system", content: "Helpful" }, { role: "user", content: "hi" }],
      undefined, { provider: "anthropic", apiKey: "k" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBe("Helpful");
    expect(body.messages.every((m: any) => m.role !== "system")).toBe(true);
  });

  it("sends anthropic-version header", async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: "text", text: "ok" }]));
    await chatCompletion([{ role: "user", content: "t" }], undefined, { provider: "anthropic", apiKey: "ant-k" });
    expect(mockFetch.mock.calls[0][1].headers["anthropic-version"]).toBe("2023-06-01");
    expect(mockFetch.mock.calls[0][1].headers["x-api-key"]).toBe("ant-k");
  });

  it("converts tool msgs to user role with tool_result", async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: "text", text: "done" }]));
    await chatCompletion([
      { role: "user", content: "s" },
      { role: "assistant", content: null, tool_calls: [{ id: "tc1", type: "function" as const, function: { name: "S", arguments: "{}" } }] },
      { role: "tool", content: "res", tool_call_id: "tc1" },
    ], undefined, { provider: "anthropic", apiKey: "k" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const tm = body.messages.find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === "tool_result"));
    expect(tm).toBeDefined();
    expect(tm.role).toBe("user");
  });

  it("parses tool_use blocks", async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([
      { type: "text", text: "Searching" },
      { type: "tool_use", id: "tu1", name: "SEARCH", input: { q: "p" } },
    ]));
    const r = await chatCompletion([{ role: "user", content: "?" }], [], { provider: "anthropic", apiKey: "k" });
    expect(r.content).toBe("Searching");
    expect(r.tool_calls).toHaveLength(1);
    expect(r.tool_calls![0].function.name).toBe("SEARCH");
  });

  it("maps usage", async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: "text", text: "ok" }]));
    const r = await chatCompletion([{ role: "user", content: "t" }], undefined, { provider: "anthropic", apiKey: "k" });
    expect(r.usage).toEqual({ inputTokens: 15, outputTokens: 25 });
  });

  it("uses input_schema for tools", async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: "text", text: "ok" }]));
    await chatCompletion([{ role: "user", content: "t" }],
      [{ name: "R", description: "Reply", parameters: { type: "object", properties: {}, required: [] as const } }],
      { provider: "anthropic", apiKey: "k" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools[0].input_schema).toBeDefined();
    expect(body.tools[0].parameters).toBeUndefined();
  });

  it("merges consecutive user messages", async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicResponse([{ type: "text", text: "ok" }]));
    await chatCompletion([
      { role: "user", content: "start" },
      { role: "assistant", content: null, tool_calls: [
        { id: "t1", type: "function" as const, function: { name: "A", arguments: "{}" } },
        { id: "t2", type: "function" as const, function: { name: "B", arguments: "{}" } },
      ]},
      { role: "tool", content: "r1", tool_call_id: "t1" },
      { role: "tool", content: "r2", tool_call_id: "t2" },
    ], undefined, { provider: "anthropic", apiKey: "k" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const last = body.messages[body.messages.length - 1];
    expect(last.role).toBe("user");
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toHaveLength(2);
  });
});
