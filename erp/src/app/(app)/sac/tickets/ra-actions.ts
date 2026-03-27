"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { reclameaquiOutboundQueue } from "@/lib/queue";
import { ReclameAquiClient, ReclameAquiError } from "@/lib/reclameaqui/client";
import { RaModerationReason } from "@/lib/reclameaqui/types";
import type { RaReputation, RaClientConfig } from "@/lib/reclameaqui/types";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RaActionResult {
  success: boolean;
  error?: string;
}

export interface RaReputationData {
  periods: {
    periodKey: string;
    periodAlias: string;
    responseIndex: number;
    solutionsPercentage: number;
    finalGrade: number;
    avgGrade: number;
    complaintsCount: number;
    reputationCode: string;
    reputationName: string;
  }[];
}

export interface RaReputationResult extends RaActionResult {
  data?: RaReputationData;
}

export interface RaAvailableAction {
  action: "SEND_PUBLIC" | "SEND_PRIVATE" | "REQUEST_EVALUATION" | "REQUEST_MODERATION" | "FINISH_PRIVATE" | "APPROVE_SUGGESTION";
  enabled: boolean;
  reason: string | null; // motivo se disabled
}

export interface RaTicketContext {
  ticketId: string;
  raExternalId: string | null;
  subject: string;
  description: string;
  erpStatus: string;
  raStatusId: number | null;
  raStatusName: string | null;
  raReason: string | null;
  raFeeling: string | null;
  raCategories: string[];
  raRating: string | null;
  raResolvedIssue: boolean | null;
  raBackDoingBusiness: boolean | null;
  raPublicTreatmentTime: string | null;
  raPrivateTreatmentTime: string | null;
  raRatingDate: string | null;
  raCommentsCount: number;
  raUnreadCount: number;
  raModerationStatus: string | null;
  raFrozen: boolean;
  raActive: boolean;
  consumerConsideration: string | null;
  companyConsideration: string | null;
  whatsappEval: { sent: boolean | null; done: boolean | null } | null;
  client: { name: string; email: string | null; phone: string | null };
  availableActions: RaAvailableAction[];
  recentMessages: Array<{
    content: string;
    direction: string;
    createdAt: string;
    isInternal: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Error Mapping
// ---------------------------------------------------------------------------

const RA_ERROR_MESSAGES: Record<number, string> = {
  4000: "Requisição inválida para o Reclame Aqui",
  4010: "Autenticação com Reclame Aqui falhou — verifique as credenciais",
  4030: "Sem permissão para esta ação no Reclame Aqui",
  4040: "Ticket não encontrado no Reclame Aqui",
  4050: "Ação não permitida pela API do Reclame Aqui",
  4090: "Ticket inativo",
  4091: "Ticket não permite esta ação no momento",
  4095: "Ticket já foi avaliado",
  4220: "Dados inválidos — verifique os campos enviados",
  4290: "Limite de requisições excedido — tente novamente em alguns minutos",
  5000: "Erro interno do Reclame Aqui — tente novamente",
  5030: "Reclame Aqui temporariamente indisponível",
  40930: "Mensagem duplicada — já foi enviada",
};

function mapRaError(err: unknown): string {
  if (err instanceof Reclam