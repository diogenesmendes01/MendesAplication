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
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ProviderConfig {
  provider: string; // openai | anthropic | deepseek | grok | qwen
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ─── Provider constants ───────────────────────────────────────────────────────

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com",
  grok: "https://api.x.ai",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode",
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
  anthropic: "claude-sonnet-4-20250514",
  grok: "grok-2",
  qwen: "qwen-max",
};

// ─── Backward-compat helper ───────────────────────────────────────────────────

/**
 * Reads provider config from legacy environment variables.
 * Use when caller does not have per-company config available.
 */
export function getEnvProviderConfig(): ProviderConfig {
  const provider = process.env.AI_PROVIDER || "openai";
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error("AI_API_KEY environment variable is not set");
  }
  return {
    provider,
    apiKey,
    model: process.env.AI_MODEL || undefined,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function chatCompletion(
  messages: AiMessage[],
  tools: AiToolDefinition[] | undefined,
  config: ProviderConfig
): Promise<AiResponse> {
  const timeout = parseInt(process.env.AI_TIMEOUT || "30000", 10);

  if (["openai", "deepseek", "grok", "qwen"].includes(config.provider)) {
    return openaiCompatibleCompletion(config, messages, tools, timeout);
  }

  if (config.provider === "anthropic") {
    return anthropicCompletion(config, messages, tools, timeout);
  }

  throw new Error(`Provedor AI nao suportado: ${config.provider}`);
}

// ─── OpenAI / DeepSeek / Grok / Qwen (Chat Completions API) ──────────────────

async function openaiCompatibleCompletion(
  config: ProviderConfig,
  messages: AiMessage[],
  tools?: AiToolDefinition[],
  timeout = 30000
): Promise<AiResponse> {
  const baseUrl =
    PROVIDER_BASE_URLS[config.provider] || PROVIDER_BASE_URLS.openai;
  const model =
    config.model || DEFAULT_MODELS[config.provider] || DEFAULT_MODELS.openai;

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
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.maxTokens) body.max_tokens = config.maxTokens;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(
        `${config.provider} API error ${res.status}: ${errorBody}`
      );
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error(`${config.provider} API retornou resposta vazia`);
    }

    const msg = choice.message;
    return {
      content: msg.content || null,
      tool_calls: msg.tool_calls?.map(
        (tc: Record<string, unknown>) => ({
          id: tc.id as string,
          type: "function" as const,
          function: tc.function as { name: string; arguments: string },
        })
      ),
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
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
  config: ProviderConfig,
  messages: AiMessage[],
  tools?: AiToolDefinition[],
  timeout = 30000
): Promise<AiResponse> {
  const model =
    config.model || DEFAULT_MODELS.anthropic;

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
  const anthropicMessages: AnthropicMessage[] = conversationMessages.map(
    (m) => {
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
    }
  );

  // Merge consecutive user messages (Anthropic requires alternating roles)
  const mergedMessages = mergeConsecutiveUserMessages(anthropicMessages);

  const body: Record<string, unknown> = {
    model,
    messages: mergedMessages,
    max_tokens: config.maxTokens || 4096,
  };

  if (systemPrompt) body.system = systemPrompt;
  if (config.temperature !== undefined) body.temperature = config.temperature;

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
        "x-api-key": config.apiKey,
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
  usage?: { input_tokens?: number; output_tokens?: number };
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
    usage: data.usage
      ? {
          inputTokens: data.usage.input_tokens ?? 0,
          outputTokens: data.usage.output_tokens ?? 0,
        }
      : undefined,
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
