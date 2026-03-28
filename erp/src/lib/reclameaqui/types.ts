// ============================================================
// Reclame Aqui (HugMe) API — Type Definitions
// ============================================================
// Based on RA HugMe API docs (developer.hugme.com.br)
// Rate limit: 10 calls/min | Timestamps: ISO 8601

// ──────────────────────────────────────────────
// Client Configuration
// ──────────────────────────────────────────────

export interface RaClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string; // e.g. "https://app.hugme.com.br/api"
}

// ──────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────

export interface RaAuthResponse {
  access_token: string;
  token_type: string; // "Bearer"
  expires_in: number; // seconds
  scope: string;
  rate_limit: number;
  license_start_at: string;
  license_end_at: string;
}

// ──────────────────────────────────────────────
// Error
// ──────────────────────────────────────────────

export interface RaError {
  message: string;
  code: number;
  success: boolean;
}

// ──────────────────────────────────────────────
// Company
// ──────────────────────────────────────────────

export interface RaCompany {
  companyId: number;
  name: string;
}

// ──────────────────────────────────────────────
// Customer
// ──────────────────────────────────────────────

export interface RaCustomer {
  id?: number;
  name: string;
  email: string[];
  cpf: string[];
  phone_numbers: string[];
  city?: string;
  state?: string;
}

// ──────────────────────────────────────────────
// Status
// ──────────────────────────────────────────────

export interface RaStatus {
  id: number;
  name: string;
}

/**
 * RA Status IDs:
 *  5  = Não respondido
 *  6  = Respondido
 *  7  = Réplica do consumidor
 *  8  = Réplica da empresa
 *  9  = Avaliado
 * 10  = Congelado
 * 12  = Desativado pelo consumidor
 * 13  = Inativa no RA
 * 18  = Avaliado Resolvido
 * 19  = Avaliado Não Resolvido
 * 20  = Réplica
 */
export const RA_STATUS = {
  NAO_RESPONDIDO: 5,
  RESPONDIDO: 6,
  REPLICA_CONSUMIDOR: 7,
  REPLICA_EMPRESA: 8,
  AVALIADO: 9,
  CONGELADO: 10,
  DESATIVADO_CONSUMIDOR: 12,
  INATIVA_RA: 13,
  AVALIADO_RESOLVIDO: 18,
  AVALIADO_NAO_RESOLVIDO: 19,
  REPLICA: 20,
} as const;

/**
 * HugMe Status IDs:
 *  1  = Pendente
 *  2  = Respondido
 *  3  = Fechado
 *  4  = Arquivado
 * 15  = Inativo na origem
 * 16  = Na fila
 * 17  = Redistribuição
 * 21  = Novo
 * 22  = Aguardando avaliação
 */
export const HUGME_STATUS = {
  PENDENTE: 1,
  RESPONDIDO: 2,
  FECHADO: 3,
  ARQUIVADO: 4,
  INATIVO_ORIGEM: 15,
  NA_FILA: 16,
  REDISTRIBUICAO: 17,
  NOVO: 21,
  AGUARDANDO_AVALIACAO: 22,
} as const;

// ──────────────────────────────────────────────
// Interaction Types & Detail Types
// ──────────────────────────────────────────────

/**
 * RA Interaction Type IDs (API v2.10.0):
 *
 * INBOUND (consumer → company):
 *   1  = Manifestação (reclamação original)
 *   6  = Mensagem privada - Consumidor
 *   7  = Comentário de terceiro
 *  11  = Avaliação
 *
 * OUTBOUND (company → consumer):
 *   2  = Resposta (pública)
 *   3  = Mensagem privada - Empresa
 *   4  = Tweet
 *   5  = Facebook Post
 *   8  = Pedido de Mediação
 *   9  = Resposta de Mediação
 *  10  = Redistribuição
 *
 * SYSTEM (auto):
 * 151  = Moderação automática
 */
export const RA_INTERACTION_TYPES = {
  MANIFESTACAO: 1,
  RESPOSTA: 2,
  MENSAGEM_PRIVADA_EMPRESA: 3,
  TWEET: 4,
  FACEBOOK_POST: 5,
  MENSAGEM_PRIVADA_CONSUMIDOR: 6,
  COMENTARIO_TERCEIRO: 7,
  PEDIDO_MEDIACAO: 8,
  RESPOSTA_MEDIACAO: 9,
  REDISTRIBUICAO: 10,
  AVALIACAO: 11,
  AUTO_MODERACAO: 151,
} as const;

/**
 * RA Interaction Detail Type IDs.
 */
export const RA_DETAIL_TYPES = {
  ASSUNTO: 1,
  SENTIMENTO: 2,
  CONTATO: 3,
  RESOLVIDA: 4,
  VOLTARIA_NEGOCIO: 5,
  NOTA: 6,
  SPECIAL_FIELDS: 7,
  IP: 8,
  MEDIACAO_MOTIVO: 9,
  MEDIACAO_CASE_NUMBER: 10,
  MEDIACAO_TRIAL_BODY: 11,
  MEDIACAO_MOTIVO_ID: 12,
  ACEITA: 13,
  ASSUNTO_ID: 14,
  ANEXO: 15,
  ID_SITE_RA: 25,
  ANEXO_2: 33,
  EMAIL: 34,
  MIGRAR: 36,
  TITULO_MODERADO: 40,
} as const;

// ──────────────────────────────────────────────
// Interactions
// ──────────────────────────────────────────────

export interface RaInteractionDetail {
  ticket_detail_id: string;
  ticket_detail_type_id: number;
  name: string;
  value: string;
  code?: string | null;
  creation_date?: string;
  modification_date?: string | null;
  privacy?: boolean;
}

export interface RaInteraction {
  ticket_interaction_id: string;
  ticket_interaction_type_id: number;
  ticket_interaction_name: string;
  customer_id?: string | null;
  responsible_id?: number | null;
  responsible_name?: string | null;
  message: string;
  privacy: string | boolean;
  creation_date: string;
  modification_date?: string | null;
  delivered?: boolean;
  readed?: boolean;
  visualized?: boolean;
  video?: string | null;
  picture?: string | null;
  details: RaInteractionDetail[];
}

// ──────────────────────────────────────────────
// Moderation
// ──────────────────────────────────────────────

export interface RaModerationUser {
  id?: number;
  name?: string;
}

export interface RaModeration {
  status: string;
  reason: number;
  request_date: string;
  response_date: string | null;
  user: RaModerationUser | null;
}

/**
 * Moderation reason codes.
 * POST /ticket/v1/tickets/moderation — `reason` field.
 */
export enum RaModerationReason {
  OUTRA_EMPRESA = 1,
  DUPLICIDADE = 4,
  CONTEUDO_IMPROPRIO = 5,
  TERCEIROS = 15,
  TRABALHISTA = 16,
  NAO_VIOLOU_DIREITO = 17,
  FRAUDE = 19,
}

/** Human-readable labels for moderation reasons */
export const MODERATION_REASON_LABELS: Record<RaModerationReason, string> = {
  [RaModerationReason.OUTRA_EMPRESA]: "Reclamação de outra empresa",
  [RaModerationReason.DUPLICIDADE]: "Reclamação em duplicidade",
  [RaModerationReason.CONTEUDO_IMPROPRIO]: "Conteúdo impróprio",
  [RaModerationReason.TERCEIROS]: "Reclamação de terceiros",
  [RaModerationReason.TRABALHISTA]: "Reclamação trabalhista",
  [RaModerationReason.NAO_VIOLOU_DIREITO]:
    "A empresa não violou o direito do consumidor",
  [RaModerationReason.FRAUDE]: "Este é um caso de fraude",
};

// ──────────────────────────────────────────────
// Ticket
// ──────────────────────────────────────────────

export interface RaTicket {
  id: number;
  source_external_id: string;
  complaint_title: string;
  complaint_content: string;
  complaint_response_content: string | null;
  creation_date: string;
  last_modification_date: string;
  customer: RaCustomer;
  company: RaCompany;
  ra_status: RaStatus;
  hugme_status: RaStatus;
  request_evaluation: boolean;
  request_moderation: boolean;
  resolved_issue: boolean | null;
  back_doing_business: boolean | null;
  rating: string | null;
  interactions: RaInteraction[];
  moderation: RaModeration | null;

  // Campos adicionais da doc
  ra_reason: string | null;
  ra_feeling: string | null;
  categories: Array<{ id: number; code: number; description: string; creation_date: string }>;
  consumer_consideration: string | null;
  consumer_consideration_date: string | null;
  company_consideration: string | null;
  company_consideration_date: string | null;
  public_treatment_time: string | null;
  private_treatment_time: string | null;
  rating_date: string | null;
  comments_count: number;
  interactions_not_readed_count: number;
  whatsapp: { sent: boolean; evaluated: boolean } | null;
  active: boolean;
  frozen: boolean;
}

// ──────────────────────────────────────────────
// Ticket Filters
// ──────────────────────────────────────────────

/** Comparator operators supported by the API */
export type RaFilterComparator = "eq" | "gt" | "gte" | "lt" | "lte" | "ne" | "in" | "nin";

export interface RaDateFilter {
  value: string; // ISO 8601
  comparator: RaFilterComparator;
}

export interface RaTicketFilters {
  id?: number;
  source_external_id?: string;
  company_id?: number;
  creation_date?: RaDateFilter | RaDateFilter[];
  last_modification_date?: RaDateFilter | RaDateFilter[];
  page_size?: number; // default 25, max 50
  page_number?: number; // default 1
  sort?: "asc" | "desc"; // sort by creation_date
}

// ──────────────────────────────────────────────
// Pagination
// ──────────────────────────────────────────────

export interface RaPaginatedResponse<T> {
  data: T[];
  meta: {
    page: {
      number: number;
      size: number;
    };
    total: number;
  };
}

// ──────────────────────────────────────────────
// Reputation
// ──────────────────────────────────────────────

export interface RaReputationPeriod {
  periodAlias: string;
  periodKey: string;
}

export interface RaReputation {
  responseIndex: number;
  solutionsPercentage: number;
  finalGrade: number;
  avgGrade: number;
  complaintsCount: number;
  period: RaReputationPeriod;
  reputation: {
    code: string;
    name: string;
  };
}

/**
 * Known period keys returned by the reputation endpoint:
 * SEISMESES, DOZEMESES, UMANOATRAS, DOISANOSATRAS, GERAL
 */
export const REPUTATION_PERIODS = [
  "SEISMESES",
  "DOZEMESES",
  "UMANOATRAS",
  "DOISANOSATRAS",
  "GERAL",
] as const;

// ──────────────────────────────────────────────
// WhatsApp Consumption
// ──────────────────────────────────────────────

export interface RaWhatsAppConsumption {
  /** API returns dynamic fields — keep flexible */
  [key: string]: unknown;
}

// ──────────────────────────────────────────────
// Count response
// ──────────────────────────────────────────────

export interface RaCountResponse {
  data: number;
}

// ──────────────────────────────────────────────
// Attachment response
// ──────────────────────────────────────────────

export interface RaAttachmentResponse {
  url: string;
  [key: string]: unknown;
}

// ──────────────────────────────────────────────
// AI Context (enriched payload for ai-agent)
// ──────────────────────────────────────────────

export interface RaAiContext {
  reason: string | null;
  feeling: string | null;
  categories: string[];
  customerName: string | null;
  complaintTitle: string | null;
  previousResponseContent: string | null;
  resolvedIssue: boolean | null;
  rating: string | null;
  interactionsCount: number;
  isReplica: boolean;
}
