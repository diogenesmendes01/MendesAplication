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
  NOVO: 21,
  AGUARDANDO_AVALIACAO: 22,
} as const;

// ──────────────────────────────────────────────
// Interactions
// ──────────────────────────────────────────────

export interface RaInteractionDetail {
  ticket_detail_id: string;
  ticket_detail_type_id: number;
  name: string;
  value: string;
}

export interface RaInteraction {
  ticket_interaction_id: string;
  ticket_interaction_type_id: number;
  ticket_interaction_name: string;
  message: string;
  privacy: string;
  creation_date: string;
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
