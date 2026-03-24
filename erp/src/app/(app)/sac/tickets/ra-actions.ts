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
  if (err instanceof ReclameAquiError) {
    return RA_ERROR_MESSAGES[err.code] ?? `Erro do Reclame Aqui: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Erro inesperado ao comunicar com Reclame Aqui";
}

// ---------------------------------------------------------------------------
// Valid moderation reasons
// ---------------------------------------------------------------------------

const VALID_MODERATION_REASONS = new Set([
  RaModerationReason.OUTRA_EMPRESA,       // 1
  RaModerationReason.DUPLICIDADE,          // 4
  RaModerationReason.CONTEUDO_IMPROPRIO,   // 5
  RaModerationReason.TERCEIROS,            // 15
  RaModerationReason.TRABALHISTA,          // 16
  RaModerationReason.NAO_VIOLOU_DIREITO,   // 17
  RaModerationReason.FRAUDE,               // 19
]);

// ---------------------------------------------------------------------------
// Reputation Cache (in-memory, 1 hour TTL)
// ---------------------------------------------------------------------------

const reputationCache = new Map<string, { data: RaReputationData; expiresAt: number }>();
const REPUTATION_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Helper: build RA client from Channel config
// ---------------------------------------------------------------------------

async function getRaClientForCompany(companyId: string): Promise<{ client: ReclameAquiClient; raCompanyId: number }> {
  const channel = await prisma.channel.findFirst({
    where: { companyId, type: "RECLAMEAQUI", isActive: true },
    select: { config: true },
  });

  if (!channel) {
    throw new Error("Canal Reclame Aqui não configurado para esta empresa");
  }

  const config = channel.config as unknown as RaClientConfig & { companyId?: number };

  if (!config.clientId || !config.clientSecret || !config.baseUrl) {
    throw new Error("Configuração do canal Reclame Aqui incompleta");
  }

  const raCompanyId = config.companyId;
  if (!raCompanyId) {
    throw new Error("ID da empresa no Reclame Aqui não configurado");
  }

  return {
    client: new ReclameAquiClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      baseUrl: config.baseUrl,
    }),
    raCompanyId,
  };
}

// ---------------------------------------------------------------------------
// 1. approveSuggestion
// ---------------------------------------------------------------------------

export async function approveSuggestion(
  messageId: string,
  companyId: string,
  editedPrivate?: string,
  editedPublic?: string
): Promise<RaActionResult> {
  try {
    const session = await requireCompanyAccess(companyId);

    const message = await prisma.ticketMessage.findFirst({
      where: { id: messageId },
      include: {
        ticket: {
          select: {
            id: true,
            companyId: true,
            raExternalId: true,
            client: { select: { email: true } },
          },
        },
      },
    });

    if (!message) {
      return { success: false, error: "Mensagem não encontrada" };
    }

    if (message.ticket.companyId !== companyId) {
      return { success: false, error: "Acesso negado" };
    }

    if (!message.isAiGenerated) {
      return { success: false, error: "Esta mensagem não é uma sugestão da IA" };
    }

    if (message.deliveryStatus !== "PENDING_APPROVAL") {
      return { success: false, error: "Esta sugestão já foi processada" };
    }

    // Parse content JSON to get suggestion messages
    let parsed: { privateMessage?: string; publicMessage?: string };
    try {
      parsed = JSON.parse(message.content);
    } catch {
      return { success: false, error: "Conteúdo da sugestão em formato inválido" };
    }

    const privateMessage = editedPrivate ?? parsed.privateMessage;
    const publicMessage = editedPublic ?? parsed.publicMessage;

    if (!privateMessage && !publicMessage) {
      return { success: false, error: "Nenhuma mensagem para enviar" };
    }

    const clientEmail = message.ticket.client.email;

    // Update delivery status to QUEUED
    await prisma.ticketMessage.update({
      where: { id: messageId },
      data: {
        deliveryStatus: "QUEUED",
        // If edited, update content with the edited version
        ...(editedPrivate || editedPublic
          ? {
              content: JSON.stringify({
                privateMessage: privateMessage ?? parsed.privateMessage,
                publicMessage: publicMessage ?? parsed.publicMessage,
              }),
            }
          : {}),
      },
    });

    // Enqueue outbound job
    await reclameaquiOutboundQueue.add("RA_SEND_DUAL", {
      messageId,
      ticketId: message.ticket.id,
      raExternalId: message.ticket.raExternalId,
      companyId,
      publicMessage,
      privateMessage,
      email: clientEmail,
    });

    await logAuditEvent({
      userId: session.userId,
      action: "UPDATE",
      entity: "TicketMessage",
      entityId: messageId,
      dataAfter: {
        action: "APPROVE_RA_SUGGESTION",
        deliveryStatus: "QUEUED",
        edited: !!(editedPrivate || editedPublic),
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { success: true };
  } catch (err) {
    logger.error("[ra-actions] approveSuggestion error:", err);
    return { success: false, error: mapRaError(err) };
  }
}

// ---------------------------------------------------------------------------
// 2. discardSuggestion
// ---------------------------------------------------------------------------

export async function discardSuggestion(
  messageId: string,
  companyId: string
): Promise<RaActionResult> {
  try {
    const session = await requireCompanyAccess(companyId);

    const message = await prisma.ticketMessage.findFirst({
      where: { id: messageId },
      include: {
        ticket: { select: { companyId: true } },
      },
    });

    if (!message) {
      return { success: false, error: "Mensagem não encontrada" };
    }

    if (message.ticket.companyId !== companyId) {
      return { success: false, error: "Acesso negado" };
    }

    if (message.deliveryStatus !== "PENDING_APPROVAL") {
      return { success: false, error: "Esta sugestão já foi processada" };
    }

    await prisma.ticketMessage.update({
      where: { id: messageId },
      data: { deliveryStatus: "DISCARDED" },
    });

    await logAuditEvent({
      userId: session.userId,
      action: "UPDATE",
      entity: "TicketMessage",
      entityId: messageId,
      dataAfter: {
        action: "DISCARD_RA_SUGGESTION",
        deliveryStatus: "DISCARDED",
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { success: true };
  } catch (err) {
    logger.error("[ra-actions] discardSuggestion error:", err);
    return { success: false, error: mapRaError(err) };
  }
}

// ---------------------------------------------------------------------------
// 3. sendRaResponse
// ---------------------------------------------------------------------------

export async function sendRaResponse(
  ticketId: string,
  companyId: string,
  publicMessage: string,
  privateMessage?: string,
  email?: string
): Promise<RaActionResult> {
  try {
    const session = await requireCompanyAccess(companyId);

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, companyId },
      include: {
        channel: { select: { type: true } },
        client: { select: { email: true } },
      },
    });

    if (!ticket) {
      return { success: false, error: "Ticket não encontrado" };
    }

    if (ticket.channel?.type !== "RECLAMEAQUI") {
      return { success: false, error: "Este ticket não pertence ao canal Reclame Aqui" };
    }

    if (!publicMessage?.trim() && !privateMessage?.trim()) {
      return { success: false, error: "Pelo menos uma mensagem (pública ou privada) é obrigatória" };
    }

    const recipientEmail = email ?? ticket.client.email;
    const hasPublic = !!publicMessage?.trim();
    const hasPrivate = !!privateMessage?.trim();

    // Determine job type
    let jobName: string;
    if (hasPublic && hasPrivate) {
      jobName = "RA_SEND_DUAL";
    } else if (hasPublic) {
      jobName = "RA_SEND_PUBLIC";
    } else {
      jobName = "RA_SEND_PRIVATE";
    }

    await reclameaquiOutboundQueue.add(jobName, {
      ticketId,
      raExternalId: ticket.raExternalId,
      companyId,
      publicMessage: hasPublic ? publicMessage.trim() : undefined,
      privateMessage: hasPrivate ? privateMessage!.trim() : undefined,
      email: recipientEmail,
    });

    await logAuditEvent({
      userId: session.userId,
      action: "CREATE",
      entity: "RaResponse",
      entityId: ticketId,
      dataAfter: {
        action: "SEND_RA_RESPONSE",
        jobType: jobName,
        hasPublic,
        hasPrivate,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { success: true };
  } catch (err) {
    logger.error("[ra-actions] sendRaResponse error:", err);
    return { success: false, error: mapRaError(err) };
  }
}

// ---------------------------------------------------------------------------
// 4. requestRaEvaluation
// ---------------------------------------------------------------------------

export async function requestRaEvaluation(
  ticketId: string,
  companyId: string
): Promise<RaActionResult> {
  try {
    const session = await requireCompanyAccess(companyId);

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, companyId },
      select: {
        id: true,
        raExternalId: true,
        raCanEvaluate: true,
        channel: { select: { type: true } },
      },
    });

    if (!ticket) {
      return { success: false, error: "Ticket não encontrado" };
    }

    if (ticket.channel?.type !== "RECLAMEAQUI") {
      return { success: false, error: "Este ticket não pertence ao canal Reclame Aqui" };
    }

    if (!ticket.raCanEvaluate) {
      return { success: false, error: "Este ticket não está elegível para solicitação de avaliação" };
    }

    await reclameaquiOutboundQueue.add("RA_REQUEST_EVALUATION", {
      ticketId,
      raExternalId: ticket.raExternalId,
      companyId,
    });

    await logAuditEvent({
      userId: session.userId,
      action: "CREATE",
      entity: "RaEvaluationRequest",
      entityId: ticketId,
      dataAfter: {
        action: "REQUEST_RA_EVALUATION",
        raExternalId: ticket.raExternalId,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { success: true };
  } catch (err) {
    logger.error("[ra-actions] requestRaEvaluation error:", err);
    return { success: false, error: mapRaError(err) };
  }
}

// ---------------------------------------------------------------------------
// 5. requestRaModeration
// ---------------------------------------------------------------------------

export async function requestRaModeration(
  ticketId: string,
  companyId: string,
  reason: number,
  message: string,
  migrateTO?: number
): Promise<RaActionResult> {
  try {
    const session = await requireCompanyAccess(companyId);

    if (!VALID_MODERATION_REASONS.has(reason)) {
      return {
        success: false,
        error: `Motivo de moderação inválido. Valores aceitos: ${[...VALID_MODERATION_REASONS].join(", ")}`,
      };
    }

    if (!message?.trim()) {
      return { success: false, error: "Mensagem de justificativa é obrigatória" };
    }

    if (reason === RaModerationReason.OUTRA_EMPRESA && !migrateTO) {
      return { success: false, error: "ID da empresa destino é obrigatório para moderação por 'outra empresa'" };
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, companyId },
      select: {
        id: true,
        raExternalId: true,
        channel: { select: { type: true } },
      },
    });

    if (!ticket) {
      return { success: false, error: "Ticket não encontrado" };
    }

    if (ticket.channel?.type !== "RECLAMEAQUI") {
      return { success: false, error: "Este ticket não pertence ao canal Reclame Aqui" };
    }

    await reclameaquiOutboundQueue.add("RA_REQUEST_MODERATION", {
      ticketId,
      raExternalId: ticket.raExternalId,
      companyId,
      reason,
      message: message.trim(),
      migrateTO,
    });

    await logAuditEvent({
      userId: session.userId,
      action: "CREATE",
      entity: "RaModerationRequest",
      entityId: ticketId,
      dataAfter: {
        action: "REQUEST_RA_MODERATION",
        reason,
        raExternalId: ticket.raExternalId,
        migrateTO,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { success: true };
  } catch (err) {
    logger.error("[ra-actions] requestRaModeration error:", err);
    return { success: false, error: mapRaError(err) };
  }
}

// ---------------------------------------------------------------------------
// 6. getRaReputation
// ---------------------------------------------------------------------------

export async function getRaReputation(
  companyId: string
): Promise<RaReputationResult> {
  try {
    await requireCompanyAccess(companyId);

    // Check cache
    const cached = reputationCache.get(companyId);
    if (cached && Date.now() < cached.expiresAt) {
      return { success: true, data: cached.data };
    }

    const { client, raCompanyId } = await getRaClientForCompany(companyId);

    const reputations: RaReputation[] = await client.getReputation(raCompanyId);

    const data: RaReputationData = {
      periods: reputations.map((r) => ({
        periodKey: r.period.periodKey,
        periodAlias: r.period.periodAlias,
        responseIndex: r.responseIndex,
        solutionsPercentage: r.solutionsPercentage,
        finalGrade: r.finalGrade,
        avgGrade: r.avgGrade,
        complaintsCount: r.complaintsCount,
        reputationCode: r.reputation.code,
        reputationName: r.reputation.name,
      })),
    };

    // Cache for 1 hour
    reputationCache.set(companyId, {
      data,
      expiresAt: Date.now() + REPUTATION_CACHE_TTL_MS,
    });

    return { success: true, data };
  } catch (err) {
    logger.error("[ra-actions] getRaReputation error:", err);
    return { success: false, error: mapRaError(err) };
  }
}
