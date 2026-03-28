"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { reclameaquiOutboundQueue } from "@/lib/queue";
import { ReclameAquiClient, ReclameAquiError } from "@/lib/reclameaqui/client";
import { RaModerationReason } from "@/lib/reclameaqui/types";
import type { RaReputation, RaClientConfig } from "@/lib/reclameaqui/types";
import { RA_ERROR_MESSAGES } from "@/lib/reclameaqui/errors";
import { RA_ATTACHMENT_LIMITS } from "@/lib/reclameaqui/attachments";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { promises as fs } from "fs";
import crypto from "crypto";

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
  reason: string | null;
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
  raSlaDeadline: string | null;
  consumerConsideration: string | null;
  companyConsideration: string | null;
  whatsappEval: { sent: boolean | null; done: boolean | null } | null;
  client: { name: string; email: string | null; phone: string | null; cpfCnpj: string | null };
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
// getRaTicketContext — enriched context for the RA detail panel
// ---------------------------------------------------------------------------

export async function getRaTicketContext(
  ticketId: string,
  companyId: string
): Promise<RaTicketContext | null> {
  await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: {
      id: true,
      subject: true,
      description: true,
      status: true,
      raExternalId: true,
      raStatusId: true,
      raStatusName: true,
      raCanEvaluate: true,
      raCanModerate: true,
      raRating: true,
      raResolvedIssue: true,
      raBackDoingBusiness: true,
      raFrozen: true,
      raConsumerConsideration: true,
      raCompanyConsideration: true,
      client: { select: { name: true, email: true, telefone: true, cpfCnpj: true } },
      channel: { select: { type: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { content: true, direction: true, createdAt: true, isInternal: true },
      },
    },
  });

  if (!ticket || ticket.channel?.type !== "RECLAMEAQUI") return null;

  const actions: RaAvailableAction[] = [
    {
      action: "SEND_PUBLIC",
      enabled: !ticket.raFrozen,
      reason: ticket.raFrozen ? "Ticket congelado" : null,
    },
    {
      action: "SEND_PRIVATE",
      enabled: !ticket.raFrozen,
      reason: ticket.raFrozen ? "Ticket congelado" : null,
    },
    {
      action: "REQUEST_EVALUATION",
      enabled: ticket.raCanEvaluate ?? false,
      reason: !ticket.raCanEvaluate ? "Avaliação indisponível" : null,
    },
    {
      action: "REQUEST_MODERATION",
      enabled: ticket.raCanModerate ?? false,
      reason: !ticket.raCanModerate ? "Moderação indisponível" : null,
    },
    {
      action: "FINISH_PRIVATE",
      enabled: !ticket.raFrozen,
      reason: ticket.raFrozen ? "Ticket congelado" : null,
    },
  ];

  // Check for pending AI suggestion
  const pendingSuggestion = await prisma.ticketMessage.findFirst({
    where: { ticketId, deliveryStatus: "PENDING_APPROVAL" },
    select: { id: true },
  });
  if (pendingSuggestion) {
    actions.push({ action: "APPROVE_SUGGESTION", enabled: true, reason: null });
  }

  return {
    ticketId: ticket.id,
    raExternalId: ticket.raExternalId,
    subject: ticket.subject ?? "",
    description: ticket.description ?? "",
    erpStatus: ticket.status,
    raStatusId: ticket.raStatusId,
    raStatusName: ticket.raStatusName,
    raReason: (ticket as any).raReason ?? null,
    raFeeling: (ticket as any).raFeeling ?? null,
    raCategories: (ticket as any).raCategories ?? [],
    raRating: ticket.raRating,
    raResolvedIssue: ticket.raResolvedIssue,
    raBackDoingBusiness: ticket.raBackDoingBusiness,
    raPublicTreatmentTime: (ticket as any).raPublicTreatmentTime ?? null,
    raPrivateTreatmentTime: (ticket as any).raPrivateTreatmentTime ?? null,
    raRatingDate: (ticket as any).raRatingDate?.toISOString() ?? null,
    raCommentsCount: (ticket as any).raCommentsCount ?? 0,
    raUnreadCount: (ticket as any).raUnreadCount ?? 0,
    raModerationStatus: (ticket as any).raModerationStatus ?? null,
    raFrozen: ticket.raFrozen ?? false,
    raActive: (ticket as any).raActive ?? true,
    raSlaDeadline: (ticket as any).raSlaDeadline?.toISOString() ?? null,
    consumerConsideration: ticket.raConsumerConsideration,
    companyConsideration: ticket.raCompanyConsideration,
    whatsappEval: (ticket as any).raWhatsappEvalSent != null ? {
      sent: (ticket as any).raWhatsappEvalSent,
      done: (ticket as any).raWhatsappEvalDone,
    } : null,
    client: {
      name: ticket.client?.name ?? "",
      email: ticket.client?.email ?? null,
      phone: ticket.client?.telefone ?? null,
      cpfCnpj: ticket.client?.cpfCnpj ?? null,
    },
    availableActions: actions,
    recentMessages: ticket.messages.map((m) => ({
      content: m.content,
      direction: m.direction,
      createdAt: m.createdAt.toISOString(),
      isInternal: m.isInternal,
    })),
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

    // Enqueue outbound job — fall back to RA_SEND_PUBLIC if no client email
    if (clientEmail && privateMessage) {
      await reclameaquiOutboundQueue.add("RA_SEND_DUAL", {
        messageId,
        ticketId: message.ticket.id,
        raExternalId: message.ticket.raExternalId,
        companyId,
        publicMessage,
        privateMessage,
        email: clientEmail,
      });
    } else {
      // No email available — can only send public message
      await reclameaquiOutboundQueue.add("RA_SEND_PUBLIC", {
        messageId,
        ticketId: message.ticket.id,
        raExternalId: message.ticket.raExternalId,
        companyId,
        message: publicMessage,
      });
    }

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
    logger.error({ err }, "[ra-actions] approveSuggestion error");
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
    logger.error({ err }, "[ra-actions] discardSuggestion error");
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
    logger.error({ err }, "[ra-actions] sendRaResponse error");
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
    logger.error({ err }, "[ra-actions] requestRaEvaluation error");
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
        error: `Motivo de moderação inválido. Valores aceitos: ${Array.from(VALID_MODERATION_REASONS).join(", ")}`,
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
    logger.error({ err }, "[ra-actions] requestRaModeration error");
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
    logger.error({ err }, "[ra-actions] getRaReputation error");
    return { success: false, error: mapRaError(err) };
  }
}

// ---------------------------------------------------------------------------
// 7. finishPrivateMessage
// ---------------------------------------------------------------------------

export async function finishPrivateMessage(
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
        channel: { select: { type: true } },
      },
    });

    if (!ticket) {
      return { success: false, error: "Ticket não encontrado" };
    }

    if (ticket.channel?.type !== "RECLAMEAQUI") {
      return { success: false, error: "Este ticket não pertence ao canal Reclame Aqui" };
    }

    if (!ticket.raExternalId) {
      return { success: false, error: "Ticket sem ID externo do Reclame Aqui" };
    }

    await reclameaquiOutboundQueue.add("RA_FINISH_PRIVATE", {
      ticketId: ticket.id,
      raExternalId: ticket.raExternalId,
      companyId,
    });

    await logAuditEvent({
      userId: session.userId,
      action: "UPDATE",
      entity: "RaFinishPrivate",
      entityId: ticketId,
      dataAfter: {
        action: "FINISH_PRIVATE_MESSAGE",
        raExternalId: ticket.raExternalId,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { success: true };
  } catch (err) {
    logger.error({ err }, "[ra-actions] finishPrivateMessage error");
    return { success: false, error: mapRaError(err) };
  }
}

// ---------------------------------------------------------------------------
// Helper: save FormData files to disk, return paths
// ---------------------------------------------------------------------------

async function saveFilesToDisk(
  ticketId: string,
  formData: FormData
): Promise<string[]> {
  const tempDir = `/tmp/ra-uploads/${ticketId}`;
  await fs.mkdir(tempDir, { recursive: true });

  const filePaths: string[] = [];
  const entries = formData.getAll("files");
  for (const entry of entries) {
    if (entry instanceof File) {
      const ext = entry.name.split(".").pop() ?? "";
      const safeName = `${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
      const filePath = `${tempDir}/${safeName}`;
      await fs.writeFile(filePath, Buffer.from(await entry.arrayBuffer()));
      filePaths.push(filePath);
    }
  }

  return filePaths;
}

// ---------------------------------------------------------------------------
// 8. sendPrivateMessageWithAttachments
// ---------------------------------------------------------------------------

export async function sendPrivateMessageWithAttachments(
  ticketId: string,
  companyId: string,
  message: string,
  formData?: FormData
): Promise<RaActionResult> {
  try {
    const session = await requireCompanyAccess(companyId);

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, companyId },
      select: {
        id: true,
        raExternalId: true,
        channel: { select: { type: true } },
        client: { select: { email: true } },
      },
    });

    if (!ticket?.raExternalId || ticket.channel?.type !== "RECLAMEAQUI") {
      return { success: false, error: "Ticket inválido para Reclame Aqui" };
    }

    // Server-side validation
    if (formData) {
      const rawFiles = formData.getAll("files");
      if (rawFiles.length > RA_ATTACHMENT_LIMITS.maxFiles) {
        return { success: false, error: `Máximo ${RA_ATTACHMENT_LIMITS.maxFiles} arquivos por envio` };
      }
      for (const entry of rawFiles) {
        if (entry instanceof File) {
          const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
          if (!(RA_ATTACHMENT_LIMITS.acceptedExtensions as readonly string[]).includes(ext)) {
            return { success: false, error: `Tipo não aceito: .${ext}` };
          }
          const isAudio = ["audio/mpeg", "audio/x-ms-wma", "audio/ogg", "audio/aac"].includes(entry.type);
          const maxBytes = (isAudio ? RA_ATTACHMENT_LIMITS.maxAudioSizeMB : RA_ATTACHMENT_LIMITS.maxOtherSizeMB) * 1024 * 1024;
          if (entry.size > maxBytes) {
            return { success: false, error: `${entry.name} excede o limite de tamanho` };
          }
        }
      }
    }

    // Save files to disk instead of base64 to avoid bloating Redis payloads
    let filePaths: string[] = [];
    if (formData) {
      filePaths = await saveFilesToDisk(ticket.id, formData);
    }

    // Enqueue with file paths only (lightweight payload)
    await reclameaquiOutboundQueue.add("RA_SEND_PRIVATE", {
      ticketId: ticket.id,
      raExternalId: ticket.raExternalId,
      message,
      companyId,
      email: ticket.client.email,
      filePaths: filePaths.length > 0 ? filePaths : undefined,
    });

    await logAuditEvent({
      userId: session.userId,
      action: "CREATE",
      entity: "RaPrivateMessage",
      entityId: ticketId,
      dataAfter: {
        action: "SEND_PRIVATE_WITH_ATTACHMENTS",
        attachmentCount: filePaths.length,
        raExternalId: ticket.raExternalId,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { success: true };
  } catch (err) {
    logger.error({ err }, "[ra-actions] sendPrivateMessageWithAttachments error");
    return { success: false, error: mapRaError(err) };
  }
}

// ---------------------------------------------------------------------------
// 9. requestModerationWithAttachments
// ---------------------------------------------------------------------------

export async function requestModerationWithAttachments(
  ticketId: string,
  companyId: string,
  reason: number,
  message: string,
  migrateTO?: number,
  formData?: FormData
): Promise<RaActionResult> {
  try {
    const session = await requireCompanyAccess(companyId);

    if (!VALID_MODERATION_REASONS.has(reason)) {
      return {
        success: false,
        error: `Motivo de moderação inválido. Valores aceitos: ${Array.from(VALID_MODERATION_REASONS).join(", ")}`,
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

    // Save files to disk instead of base64 to avoid bloating Redis payloads
    let filePaths: string[] = [];
    if (formData) {
      filePaths = await saveFilesToDisk(ticketId, formData);
    }

    await reclameaquiOutboundQueue.add("RA_REQUEST_MODERATION", {
      ticketId,
      raExternalId: ticket.raExternalId,
      companyId,
      reason,
      message: message.trim(),
      migrateTO,
      filePaths: filePaths.length > 0 ? filePaths : undefined,
    });

    await logAuditEvent({
      userId: session.userId,
      action: "CREATE",
      entity: "RaModerationRequest",
      entityId: ticketId,
      dataAfter: {
        action: "REQUEST_RA_MODERATION_WITH_ATTACHMENTS",
        reason,
        attachmentCount: filePaths.length,
        raExternalId: ticket.raExternalId,
        migrateTO,
      } as unknown as Prisma.InputJsonValue,
      companyId,
    });

    return { success: true };
  } catch (err) {
    logger.error({ err }, "[ra-actions] requestModerationWithAttachments error");
    return { success: false, error: mapRaError(err) };
  }
}
