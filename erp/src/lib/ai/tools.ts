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
    "Busca o historico recente de mensagens da conversa do ticket atual. Util para entender o contexto da conversa antes de responder. Anexos aparecem com summary e metadata inline.",
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

export const RESPOND_RECLAMEAQUI = defineTool({
  name: "RESPOND_RECLAMEAQUI",
  description:
    "Gera resposta dual para reclamacao no Reclame Aqui. Voce DEVE fornecer uma mensagem privada (enviada so ao consumidor) e uma mensagem publica (visivel para TODOS na internet). A mensagem publica e PERMANENTE — NUNCA inclua dados pessoais, CPF, email, telefone ou valores financeiros nela. Classifique o tipo da reclamacao.",
  parameters: {
    type: "object",
    properties: {
      privateMessage: {
        type: "string",
        description:
          "Mensagem privada para o consumidor. Pode conter dados pessoais e detalhes especificos do caso.",
      },
      publicMessage: {
        type: "string",
        description:
          "Mensagem publica visivel para TODOS. NUNCA inclua dados pessoais (CPF, email, telefone, valores). Seja profissional e empatico.",
      },
      detectedType: {
        type: "string",
        description:
          "Tipo da reclamacao detectado: boleto_nao_solicitado, cobranca_indevida, reembolso, servico_nao_entregue, qualidade_servico, trabalhista, outro",
        enum: [
          "boleto_nao_solicitado",
          "cobranca_indevida",
          "reembolso",
          "servico_nao_entregue",
          "qualidade_servico",
          "trabalhista",
          "outro",
        ],
      },
      confidence: {
        type: "number",
        description:
          "Nivel de confianca na classificacao (0.0 a 1.0)",
      },
    },
    required: ["privateMessage", "publicMessage", "detectedType", "confidence"],
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

// ─── v2 CNPJ Tools ──────────────────────────────────────────────────────────

export const LOOKUP_CLIENT_BY_CNPJ = defineTool({
  name: "LOOKUP_CLIENT_BY_CNPJ",
  description:
    "Busca um cliente pelo CNPJ ou CPF. Retorna dados do cliente, contatos adicionais e titulos pendentes. Use quando identificar um CNPJ/CPF na conversa ou em anexos e precisar vincular ao cliente correto.",
  parameters: {
    type: "object",
    properties: {
      cnpj: {
        type: "string",
        description: "CNPJ (14 digitos) ou CPF (11 digitos), apenas numeros",
      },
    },
    required: ["cnpj"],
  },
});

export const LINK_TICKET_TO_CLIENT = defineTool({
  name: "LINK_TICKET_TO_CLIENT",
  description:
    "Vincula o ticket atual a um cliente identificado por CNPJ/CPF. Se o contato (nome, email, telefone) nao existir como AdditionalContact, cria automaticamente. Use apos identificar o CNPJ do cliente via LOOKUP_CLIENT_BY_CNPJ ou pergunta direta.",
  parameters: {
    type: "object",
    properties: {
      cnpj: {
        type: "string",
        description: "CNPJ (14 digitos) ou CPF (11 digitos), apenas numeros",
      },
      contactName: {
        type: "string",
        description:
          "Nome da pessoa que esta em contato (opcional — cria AdditionalContact se fornecido)",
      },
      contactEmail: {
        type: "string",
        description: "Email da pessoa em contato (opcional)",
      },
      contactPhone: {
        type: "string",
        description: "Telefone/WhatsApp da pessoa em contato (opcional)",
      },
    },
    required: ["cnpj"],
  },
});

// ─── v2 Attachment Tools ─────────────────────────────────────────────────────

export const READ_ATTACHMENT = defineTool({
  name: "READ_ATTACHMENT",
  description:
    "Le o conteudo extraido de um anexo. Sem query, retorna o texto completo. Com query, busca informacao especifica dentro do texto do anexo. Prefira usar query quando o summary no historico nao for suficiente.",
  parameters: {
    type: "object",
    properties: {
      attachmentId: {
        type: "string",
        description:
          "ID do anexo (mostrado no historico junto ao icone 📎)",
      },
      query: {
        type: "string",
        description:
          "Busca especifica dentro do texto do anexo (opcional — ex: 'valor do boleto', 'clausula de rescisao')",
      },
    },
    required: ["attachmentId"],
  },
});

// ─── Inferred argument types (re-export for consumers) ───────────────────────

export type SearchDocumentsArgs = InferToolArgs<typeof SEARCH_DOCUMENTS>;
export type GetClientInfoArgs = InferToolArgs<typeof GET_CLIENT_INFO>;
export type GetHistoryArgs = InferToolArgs<typeof GET_HISTORY>;
export type RespondArgs = InferToolArgs<typeof RESPOND>;
export type RespondEmailArgs = InferToolArgs<typeof RESPOND_EMAIL>;
export type RespondReclameAquiArgs = InferToolArgs<typeof RESPOND_RECLAMEAQUI>;
export type EscalateArgs = InferToolArgs<typeof ESCALATE>;
export type CreateNoteArgs = InferToolArgs<typeof CREATE_NOTE>;
export type LookupClientByCnpjArgs = InferToolArgs<typeof LOOKUP_CLIENT_BY_CNPJ>;
export type LinkTicketToClientArgs = InferToolArgs<typeof LINK_TICKET_TO_CLIENT>;
export type ReadAttachmentArgs = InferToolArgs<typeof READ_ATTACHMENT>;

// ─── Tool name union type ────────────────────────────────────────────────────

/** Union of all known tool names — useful for exhaustive switches. */
export type ToolName =
  | typeof SEARCH_DOCUMENTS.name
  | typeof GET_CLIENT_INFO.name
  | typeof GET_HISTORY.name
  | typeof RESPOND.name
  | typeof RESPOND_EMAIL.name
  | typeof RESPOND_RECLAMEAQUI.name
  | typeof ESCALATE.name
  | typeof CREATE_NOTE.name
  | typeof LOOKUP_CLIENT_BY_CNPJ.name
  | typeof LINK_TICKET_TO_CLIENT.name
  | typeof READ_ATTACHMENT.name
  | typeof EXECUTE_WORKFLOW.name
  | typeof GET_WORKFLOW_STATE.name
  | typeof ADVANCE_WORKFLOW.name;

// ─── All Tools (legacy — includes WhatsApp RESPOND) ─────────────────────────

export const ALL_TOOLS: AnyAiToolDefinition[] = [
  SEARCH_DOCUMENTS,
  GET_CLIENT_INFO,
  GET_HISTORY,
  RESPOND,
  ESCALATE,
  CREATE_NOTE,
];

// ─── v2 tool groups ──────────────────────────────────────────────────────────

export const CNPJ_TOOLS: AnyAiToolDefinition[] = [
  LOOKUP_CLIENT_BY_CNPJ,
  LINK_TICKET_TO_CLIENT,
];

export const ATTACHMENT_TOOLS: AnyAiToolDefinition[] = [
  READ_ATTACHMENT,
];

// ─── Shared (non-terminal) tools ─────────────────────────────────────────────

const SHARED_TOOLS: AnyAiToolDefinition[] = [
  SEARCH_DOCUMENTS,
  GET_CLIENT_INFO,
  GET_HISTORY,
  ESCALATE,
  CREATE_NOTE,
  ...CNPJ_TOOLS,
  ...ATTACHMENT_TOOLS,
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

export const RECLAMEAQUI_TOOLS: AnyAiToolDefinition[] = [
  ...SHARED_TOOLS,
  RESPOND_RECLAMEAQUI,
];

/**
 * Returns the appropriate tool set for a given channel.
 */

// ─── Workflow Engine Tools ───────────────────────────────────────────────────

export const EXECUTE_WORKFLOW = defineTool({
  name: "EXECUTE_WORKFLOW",
  description:
    "Inicia a execucao de um workflow identificado. Use quando detectar uma intencao que corresponde a um workflow disponivel. O workflow guiara os proximos passos automaticamente.",
  parameters: {
    type: "object",
    properties: {
      workflowName: {
        type: "string",
        description: "Nome do workflow a executar",
      },
      initialData: {
        type: "object",
        description:
          "Dados ja conhecidos para preencher variaveis do workflow (ex: cnpj ja informado)",
      },
    },
    required: ["workflowName"],
  },
});

export const GET_WORKFLOW_STATE = defineTool({
  name: "GET_WORKFLOW_STATE",
  description:
    "Retorna o estado atual do workflow em execucao para este ticket — step atual, dados coletados, status. Use para entender onde o workflow parou e o que falta.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
});

export const ADVANCE_WORKFLOW = defineTool({
  name: "ADVANCE_WORKFLOW",
  description:
    "Avanca o workflow para o proximo step, salvando dados coletados. Use apos completar um step com sucesso.",
  parameters: {
    type: "object",
    properties: {
      stepResult: {
        type: "object",
        description:
          "Resultado do step atual — dados coletados, busca realizada, etc",
      },
      skipToStep: {
        type: "string",
        description:
          "Se definido, pula para esse step em vez do proximo sequencial",
      },
    },
    required: [],
  },
});

export type ExecuteWorkflowArgs = InferToolArgs<typeof EXECUTE_WORKFLOW>;
export type GetWorkflowStateArgs = InferToolArgs<typeof GET_WORKFLOW_STATE>;
export type AdvanceWorkflowArgs = InferToolArgs<typeof ADVANCE_WORKFLOW>;

export const WORKFLOW_TOOLS: AnyAiToolDefinition[] = [
  EXECUTE_WORKFLOW,
  GET_WORKFLOW_STATE,
  ADVANCE_WORKFLOW,
];

/**
 * Tools that are ALWAYS available to the agent, regardless of per-company configuration.
 *
 * Rationale:
 * - GET_HISTORY   : agent must read conversation history to have any context
 * - ESCALATE      : every agent must be able to escalate to a human — safety valve
 * - RESPOND*      : terminal tools; without them the agent cannot produce output
 *
 * These are never filtered by getToolsForChannel(), even when enabledTools is set.
 */
const ALWAYS_ON_TOOL_NAMES = new Set([
  "GET_HISTORY",
  "ESCALATE",
  "RESPOND",
  "RESPOND_EMAIL",
  "RESPOND_RECLAMEAQUI",
]);

/**
 * Returns the tool set for a given channel, with optional per-company filtering.
 *
 * ## Backward-compatibility contract
 * - `enabledTools` is **empty or undefined** → return ALL tools for the channel (default).
 *   Existing configs that predate this field get full access, no migration needed.
 * - `enabledTools` is **non-empty** → return only the listed tools + ALWAYS_ON_TOOL_NAMES.
 *   Tools outside the channel's base set are silently dropped (cross-channel safety).
 *
 * ## Always-on tools
 * GET_HISTORY, ESCALATE, RESPOND, RESPOND_EMAIL, RESPOND_RECLAMEAQUI are preserved
 * regardless of `enabledTools` — see ALWAYS_ON_TOOL_NAMES.
 *
 * @param channel     - The channel context ("WHATSAPP" | "EMAIL" | "RECLAMEAQUI")
 * @param enabledTools - Optional list of tool IDs to expose; empty/undefined = all
 * @returns Filtered subset of the channel's full tool set
 */
export function getToolsForChannel(
  channel: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI",
  enabledTools?: string[]
): AnyAiToolDefinition[] {
  let base: AnyAiToolDefinition[];
  switch (channel) {
    case "EMAIL":
      base = EMAIL_TOOLS;
      break;
    case "RECLAMEAQUI":
      base = RECLAMEAQUI_TOOLS;
      break;
    default:
      base = WHATSAPP_TOOLS;
  }

  // No filter → return all tools
  if (!enabledTools || enabledTools.length === 0) return base;

  const allowed = new Set(enabledTools.concat(Array.from(ALWAYS_ON_TOOL_NAMES)));
  return base.filter((t) => allowed.has(t.name));
}
