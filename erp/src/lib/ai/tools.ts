// NOTE: "use server" is intentionally omitted here.
// This module only exports pure constant definitions (AiToolDefinition objects).
// No server-side I/O, Prisma, or secrets are used, so it is safe to import
// from both server and client contexts (e.g. for type inference).
import { defineTool, type AnyAiToolDefinition, type InferToolArgs } from "./provider";

// ─── Tool Definitions ────────────────────────────────────────────────────────
//
// Each tool is defined via defineTool() which provides compile-time checks:
//   1. name is inferred as a string literal type
//   2. Every entry in required must be a key of properties
//   3. Typos in required produce TS errors immediately

export const SEARCH_DOCUMENTS = defineTool({
  name: "SEARCH_DOCUMENTS",
  description:
    "Busca documentos relevantes na base de conhecimento da empresa. Use para encontrar informacoes sobre produtos, servicos, politicas, procedimentos ou qualquer outro conteudo que possa ajudar a responder o cliente.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Texto de busca para encontrar documentos relevantes",
      },
    },
    required: ["query"],
  },
});

export const GET_CLIENT_INFO = defineTool({
  name: "GET_CLIENT_INFO",
  description:
    "Busca dados do cliente vinculado ao ticket atual, incluindo nome, email, telefone, empresa, e informacoes financeiras como titulos a receber pendentes e vencidos. Nao requer parametros — usa o contexto do ticket.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
});

export const GET_HISTORY = defineTool({
  name: "GET_HISTORY",
  description:
    "Busca o historico recente de mensagens da conversa do ticket atual. Util para entender o contexto da conversa antes de responder.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description:
          "Numero maximo de mensagens a retornar (padrao: 20)",
      },
    },
    required: [],
  },
});

export const RESPOND = defineTool({
  name: "RESPOND",
  description:
    "Envia uma resposta ao cliente via WhatsApp. Use esta ferramenta quando tiver uma resposta pronta para o cliente. A mensagem sera enviada diretamente pelo WhatsApp e registrada no ticket.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Mensagem a ser enviada ao cliente via WhatsApp",
      },
    },
    required: ["message"],
  },
});

export const RESPOND_EMAIL = defineTool({
  name: "RESPOND_EMAIL",
  description:
    "Envia uma resposta ao cliente por email. Use quando o canal for email. A mensagem sera enviada por email e registrada no ticket.",
  parameters: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "Assunto do email de resposta",
      },
      message: {
        type: "string",
        description: "Corpo do email (pode usar HTML simples: <b>, <i>, <br>, <p>, <ul>, <li>)",
      },
    },
    required: ["subject", "message"],
  },
});

export const ESCALATE = defineTool({
  name: "ESCALATE",
  description:
    "Escala o atendimento para um atendente humano. Use quando o cliente solicitar falar com um humano, quando o problema for muito complexo para o AI resolver, ou quando uma palavra-chave de escalacao for detectada.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "Motivo da escalacao para que o atendente humano tenha contexto",
      },
    },
    required: ["reason"],
  },
});

export const CREATE_NOTE = defineTool({
  name: "CREATE_NOTE",
  description:
    "Cria uma nota interna no ticket. Notas internas sao visiveis apenas para atendentes, nao para o cliente. Use para registrar observacoes, resumos ou informacoes relevantes sobre o atendimento.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Conteudo da nota interna",
      },
    },
    required: ["content"],
  },
});

// ─── Inferred argument types (re-export for consumers) ───────────────────────

export type SearchDocumentsArgs = InferToolArgs<typeof SEARCH_DOCUMENTS>;
export type GetClientInfoArgs = InferToolArgs<typeof GET_CLIENT_INFO>;
export type GetHistoryArgs = InferToolArgs<typeof GET_HISTORY>;
export type RespondArgs = InferToolArgs<typeof RESPOND>;
export type RespondEmailArgs = InferToolArgs<typeof RESPOND_EMAIL>;
export type EscalateArgs = InferToolArgs<typeof ESCALATE>;
export type CreateNoteArgs = InferToolArgs<typeof CREATE_NOTE>;

// ─── Tool name union type ────────────────────────────────────────────────────

/** Union of all known tool names — useful for exhaustive switches. */
export type ToolName =
  | typeof SEARCH_DOCUMENTS.name
  | typeof GET_CLIENT_INFO.name
  | typeof GET_HISTORY.name
  | typeof RESPOND.name
  | typeof RESPOND_EMAIL.name
  | typeof ESCALATE.name
  | typeof CREATE_NOTE.name;

// ─── All Tools (legacy — includes WhatsApp RESPOND) ─────────────────────────

export const ALL_TOOLS: AnyAiToolDefinition[] = [
  SEARCH_DOCUMENTS,
  GET_CLIENT_INFO,
  GET_HISTORY,
  RESPOND,
  ESCALATE,
  CREATE_NOTE,
];

// ─── Shared (non-terminal) tools ─────────────────────────────────────────────

const SHARED_TOOLS: AnyAiToolDefinition[] = [
  SEARCH_DOCUMENTS,
  GET_CLIENT_INFO,
  GET_HISTORY,
  ESCALATE,
  CREATE_NOTE,
];

// ─── Channel-specific tool sets ──────────────────────────────────────────────

export const WHATSAPP_TOOLS: AnyAiToolDefinition[] = [
  ...SHARED_TOOLS,
  RESPOND,
];

export const EMAIL_TOOLS: AnyAiToolDefinition[] = [
  ...SHARED_TOOLS,
  RESPOND_EMAIL,
];

/**
 * Returns the appropriate tool set for a given channel.
 */
export function getToolsForChannel(channel: "WHATSAPP" | "EMAIL"): AnyAiToolDefinition[] {
  return channel === "EMAIL" ? EMAIL_TOOLS : WHATSAPP_TOOLS;
}
