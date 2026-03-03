"use server";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: AiToolCall[];
  tool_call_id?: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface AiResponse {
  content?: string | null;
  tool_calls?: AiToolCall[];
}

interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function chatCompletion(
  messages: AiMessage[],
  tools?: AiToolDefinition[],
  options?: ChatCompletionOptions
): Promise<AiResponse> {
  const provider = process.env.AI_PROVIDER || "openai";
  const timeout = parseInt(process.env.AI_TIMEOUT || "30000", 10);

  switch (provider) {
    case "openai":
    case "deepseek":
      return openaiCompatibleCompletion(provider, messages, tools, options, timeout);
    case "anthropic":
      return anthropicCompletion(messages, tools, options, timeout);
    default:
      throw new Error(`Provedor AI nao suportado: ${provider}`);
  }
}

// ─── OpenAI / DeepSeek (Chat Completions API) ─────────────────────────────────

const OPENAI_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com",
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
  anthropic: "claude-sonnet-4-20250514",
};

async function openaiCompatibleCompletion(
  provider: string,
  messages: AiMessage[],
  tools?: AiToolDefinition[],
  options?: ChatCompletionOptions,
  timeout = 30000
): Promise<AiResponse> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error(`AI_API_KEY nao configurada para provider ${provider}`);

  const baseUrl = OPENAI_BASE_URLS[provider] || OPENAI_BASE_URLS.openai;
  const model = options?.model || process.env.AI_MODEL || DEFAULT_MODELS[provider];

  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      return msg;
    }),
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  if (options?.temperature !== undefined) body.temperature = options.temperature;
  if (options?.maxTokens) body.max_tokens = options.maxTokens;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`${provider} API error ${res.status}: ${errorBody}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error(`${provider} API retornou resposta vazia`);

    const msg = choice.message;
    return {
      content: msg.content || null,
      tool_calls: msg.tool_calls?.map((tc: Record<string, unknown>) => ({
        id: tc.id as string,
        type: "function" as const,
        function: tc.function as { name: string; arguments: string },
      })),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Anthropic (Messages API) ─────────────────────────────────────────────────

interface AnthropicContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

async function anthropicCompletion(
  messages: AiMessage[],
  tools?: AiToolDefinition[],
  options?: ChatCompletionOptions,
  timeout = 30000
): Promise<AiResponse> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY nao configurada para provider anthropic");

  const model = options?.model || process.env.AI_MODEL || DEFAULT_MODELS.anthropic;

  // Extract system message (Anthropic uses a separate `system` param)
  let systemPrompt: string | undefined;
  const conversationMessages: AiMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemPrompt = m.content || undefined;
    } else {
      conversationMessages.push(m);
    }
  }

  // Convert messages to Anthropic format
  const anthropicMessages: AnthropicMessage[] = conversationMessages.map((m) => {
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      // Assistant message with tool calls → tool_use content blocks
      const content: AnthropicContent[] = [];
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      for (const tc of m.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
      return { role: "assistant", content };
    }

    if (m.role === "tool") {
      // Tool result → tool_result content block
      return {
        role: "user" as const,
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id || "",
            content: m.content || "",
          },
        ],
      };
    }

    return {
      role: m.role as "user" | "assistant",
      content: m.content || "",
    };
  });

  // Merge consecutive user messages (Anthropic requires alternating roles)
  const mergedMessages = mergeConsecutiveUserMessages(anthropicMessages);

  const body: Record<string, unknown> = {
    model,
    messages: mergedMessages,
    max_tokens: options?.maxTokens || 4096,
  };

  if (systemPrompt) body.system = systemPrompt;
  if (options?.temperature !== undefined) body.temperature = options.temperature;

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errorBody}`);
    }

    const data = await res.json();
    return parseAnthropicResponse(data);
  } finally {
    clearTimeout(timer);
  }
}

function parseAnthropicResponse(data: {
  content: AnthropicContent[];
}): AiResponse {
  let textContent: string | null = null;
  const toolCalls: AiToolCall[] = [];

  for (const block of data.content || []) {
    if (block.type === "text" && block.text) {
      textContent = textContent ? textContent + block.text : block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id || "",
        type: "function",
        function: {
          name: block.name || "",
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }

  return {
    content: textContent,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function mergeConsecutiveUserMessages(
  messages: AnthropicMessage[]
): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === "user" && msg.role === "user") {
      // Merge into previous user message
      const lastContent = Array.isArray(last.content)
        ? last.content
        : [{ type: "text", text: last.content }];
      const newContent = Array.isArray(msg.content)
        ? msg.content
        : [{ type: "text", text: msg.content }];
      last.content = [...lastContent, ...newContent];
    } else {
      result.push({ ...msg });
    }
  }

  return result;
}
