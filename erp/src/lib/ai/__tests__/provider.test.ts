/**
 * Tests for provider.ts — chatCompletion dispatch, openaiCompatibleCompletion
 * (OpenAI / Grok / Qwen / DeepSeek) and anthropicCompletion.
 *
 * Covers WARN #1 from QA review (PR #71):
 *   - Provider dispatch logic
 *   - usage.inputTokens / outputTokens extraction
 *   - Grok, Qwen, DeepSeek routed via OpenAI-compatible path
 *   - Unsupported provider throws
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── fetch mock ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOpenAIResponse(
  content: string | null,
  toolCalls?: unknown[],
  promptTokens = 100,
  completionTokens = 50
) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content,
            tool_calls: toolCalls,
          },
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
    }),
    text: async () => "",
  };
}

function makeAnthropicResponse(
  textBlocks: string[],
  toolUses?: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  inputTokens = 120,
  outputTokens = 60
) {
  const content: unknown[] = textBlocks.map((t) => ({ type: "text", text: t }));
  if (toolUses) {
    for (const tu of toolUses) {
      content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
    }
  }
  return {
    ok: true,
    json: async () => ({
      content,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    text: async () => "",
  };
}

const MESSAGES = [
  { role: "system" as const, content: "Você é um assistente." },
  { role: "user" as const, content: "Olá" },
];

const BASE_CONFIG = {
  apiKey: "sk-test-key",
  model: "gpt-4o",
};

// ─── chatCompletion — provider dispatch ──────────────────────────────────────

describe("chatCompletion — provider dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches openai provider to OpenAI-compatible path", async () => {
    mockFetch.mockResolvedValue(makeOpenAIResponse("Olá!"));
    const { chatCompletion } = await import("@/lib/ai/provider");

    const result = await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "openai",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("api.openai.com");
    expect(result.content).toBe("Olá!");
  });

  it("dispatches deepseek provider to correct base URL", async () => {
    mockFetch.mockResolvedValue(makeOpenAIResponse("DeepSeek resposta"));
    const { chatCompletion } = await import("@/lib/ai/provider");

    await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "deepseek",
      model: "deepseek-chat",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("api.deepseek.com");
  });

  it("dispatches grok provider to x.ai base URL", async () => {
    mockFetch.mockResolvedValue(makeOpenAIResponse("Grok resposta"));
    const { chatCompletion } = await import("@/lib/ai/provider");

    await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "grok",
      model: "grok-3",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("api.x.ai");
  });

  it("dispatches qwen provider to dashscope base URL", async () => {
    mockFetch.mockResolvedValue(makeOpenAIResponse("Qwen resposta"));
    const { chatCompletion } = await import("@/lib/ai/provider");

    await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "qwen",
      model: "qwen-plus",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("dashscope.aliyuncs.com");
  });

  it("dispatches anthropic provider to Anthropic Messages API", async () => {
    mockFetch.mockResolvedValue(makeAnthropicResponse(["Anthropic resposta"]));
    const { chatCompletion } = await import("@/lib/ai/provider");

    await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("api.anthropic.com");
  });

  it("throws for unsupported provider", async () => {
    const { chatCompletion } = await import("@/lib/ai/provider");

    await expect(
      chatCompletion(MESSAGES, undefined, {
        ...BASE_CONFIG,
        provider: "unknown-provider",
      })
    ).rejects.toThrow("Provedor AI nao suportado: unknown-provider");
  });
});

// ─── openaiCompatibleCompletion — usage token extraction ─────────────────────

describe("openaiCompatibleCompletion — usage extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("extracts inputTokens and outputTokens from usage", async () => {
    mockFetch.mockResolvedValue(makeOpenAIResponse("Resposta", undefined, 250, 80));
    const { chatCompletion } = await import("@/lib/ai/provider");

    const result = await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "openai",
    });

    expect(result.usage).toEqual({ inputTokens: 250, outputTokens: 80 });
  });

  it("returns undefined usage when API omits it", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Ok", tool_calls: undefined } }],
        // No usage field
      }),
      text: async () => "",
    });
    const { chatCompletion } = await import("@/lib/ai/provider");

    const result = await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "openai",
    });

    expect(result.usage).toBeUndefined();
  });

  it("extracts tool_calls correctly", async () => {
    const rawToolCalls = [
      {
        id: "call-1",
        type: "function",
        function: { name: "RESPOND", arguments: '{"message":"Oi"}' },
      },
    ];
    mockFetch.mockResolvedValue(makeOpenAIResponse(null, rawToolCalls));
    const { chatCompletion } = await import("@/lib/ai/provider");

    const result = await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "openai",
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].id).toBe("call-1");
    expect(result.tool_calls![0].function.name).toBe("RESPOND");
    expect(result.tool_calls![0].function.arguments).toBe('{"message":"Oi"}');
  });

  it("sends tools in OpenAI format when provided", async () => {
    mockFetch.mockResolvedValue(makeOpenAIResponse("Ok"));
    const { chatCompletion } = await import("@/lib/ai/provider");

    const tools = [
      {
        name: "RESPOND",
        description: "Envia mensagem",
        parameters: { type: "object", properties: {} },
      },
    ];

    await chatCompletion(MESSAGES, tools, { ...BASE_CONFIG, provider: "openai" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("RESPOND");
  });

  it("throws on non-OK HTTP response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const { chatCompletion } = await import("@/lib/ai/provider");

    await expect(
      chatCompletion(MESSAGES, undefined, { ...BASE_CONFIG, provider: "openai" })
    ).rejects.toThrow("openai API error 401");
  });

  it("throws when choices array is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
      text: async () => "",
    });
    const { chatCompletion } = await import("@/lib/ai/provider");

    await expect(
      chatCompletion(MESSAGES, undefined, { ...BASE_CONFIG, provider: "openai" })
    ).rejects.toThrow("retornou resposta vazia");
  });
});

// ─── anthropicCompletion — usage token extraction & tool_use ─────────────────

describe("anthropicCompletion — usage extraction and tool_use", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("extracts inputTokens and outputTokens from Anthropic usage", async () => {
    mockFetch.mockResolvedValue(makeAnthropicResponse(["Resposta Anthropic"], undefined, 300, 90));
    const { chatCompletion } = await import("@/lib/ai/provider");

    const result = await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    });

    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 90 });
  });

  it("extracts text content from Anthropic response", async () => {
    mockFetch.mockResolvedValue(makeAnthropicResponse(["Olá, como posso ajudar?"]));
    const { chatCompletion } = await import("@/lib/ai/provider");

    const result = await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "anthropic",
    });

    expect(result.content).toBe("Olá, como posso ajudar?");
    expect(result.tool_calls).toBeUndefined();
  });

  it("extracts tool_use blocks as tool_calls", async () => {
    mockFetch.mockResolvedValue(
      makeAnthropicResponse([], [
        { id: "toolu_01", name: "RESPOND", input: { message: "Oi!" } },
      ])
    );
    const { chatCompletion } = await import("@/lib/ai/provider");

    const result = await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "anthropic",
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].id).toBe("toolu_01");
    expect(result.tool_calls![0].function.name).toBe("RESPOND");
    expect(JSON.parse(result.tool_calls![0].function.arguments)).toEqual({ message: "Oi!" });
  });

  it("sends system prompt as separate param to Anthropic", async () => {
    mockFetch.mockResolvedValue(makeAnthropicResponse(["Ok"]));
    const { chatCompletion } = await import("@/lib/ai/provider");

    await chatCompletion(MESSAGES, undefined, {
      ...BASE_CONFIG,
      provider: "anthropic",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBe("Você é um assistente.");
    // System message should NOT appear in messages array
    expect(body.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });

  it("sends tools in Anthropic input_schema format", async () => {
    mockFetch.mockResolvedValue(makeAnthropicResponse(["Ok"]));
    const { chatCompletion } = await import("@/lib/ai/provider");

    const tools = [
      {
        name: "RESPOND",
        description: "Responde ao cliente",
        parameters: { type: "object", properties: { message: { type: "string" } } },
      },
    ];

    await chatCompletion(MESSAGES, tools, { ...BASE_CONFIG, provider: "anthropic" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].input_schema).toBeDefined();
    expect(body.tools[0].name).toBe("RESPOND");
  });

  it("throws on non-OK Anthropic HTTP response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 529,
      text: async () => "Overloaded",
    });
    const { chatCompletion } = await import("@/lib/ai/provider");

    await expect(
      chatCompletion(MESSAGES, undefined, { ...BASE_CONFIG, provider: "anthropic" })
    ).rejects.toThrow("Anthropic API error 529");
  });
});
