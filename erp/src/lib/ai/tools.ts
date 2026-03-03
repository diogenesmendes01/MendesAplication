"use server";

import type { AiToolDefinition } from "./provider";

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const SEARCH_DOCUMENTS: AiToolDefinition = {
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
};

export const GET_CLIENT_INFO: AiToolDefinition = {
  name: "GET_CLIENT_INFO",
  description:
    "Busca dados do cliente vinculado ao ticket atual, incluindo nome, email, telefone, empresa, e informacoes financeiras como titulos a receber pendentes e vencidos. Nao requer parametros — usa o contexto do ticket.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const GET_HISTORY: AiToolDefinition = {
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
};

export const RESPOND: AiToolDefinition = {
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
};

export const ESCALATE: AiToolDefinition = {
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
};

export const CREATE_NOTE: AiToolDefinition = {
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
};

// ─── All Tools ───────────────────────────────────────────────────────────────

export const ALL_TOOLS: AiToolDefinition[] = [
  SEARCH_DOCUMENTS,
  GET_CLIENT_INFO,
  GET_HISTORY,
  RESPOND,
  ESCALATE,
  CREATE_NOTE,
];
