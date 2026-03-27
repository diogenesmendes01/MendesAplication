import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { decryptConfig } from "@/lib/encryption";
import { ReclameAquiClient, ReclameAquiError } from "@/lib/reclameaqui/client";
import { logger } from "@/lib/logger";
import type { RaClientConfig } from "@/lib/reclameaqui/types";
import type { MessageDeliveryStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RaSendPublicJobData {
  ticketId: string;
  message: string;
}

export interface RaSendPrivateJobData {
  ticketId: string;
  message: string;
  email: string;
}

export interface RaSendDualJobData {
  ticketId: string;
  privateMessage: string;
  publicMessage: string;
  email: string;
}

export interface RaRequestEvaluationJobData {
  ticketId: string;
}

export interface RaRequestModerationJobData {
  ticketId: string;
  reason: number;
  message: string;
  migrateTO?: number;
}

export interface RaFinishPrivateJobData {
  ticketId: string;
}

export type RaOutboundJobData =
  | RaSendPublicJobData
  | RaSendPrivateJobData
  | RaSendDualJobData
  | RaRequestEvaluationJobData
  | RaRequestModerationJobData
  | RaFinishPrivateJobData;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetches a ticket with its RA channel config in a single query.
 * Throws if ticket not found, has no raExternalId, or no active RA channel.
 */
async function getTicketWithRaChannel(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      channel: {
        select: { id: true, config: true, isActive: true, type: true },
      },
    },
  });

  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found`);
  }

  if (!ticket.raExternalId) {
    throw new Error(`Ticket ${ticketId} has no raExternalId`);
  }

  if (!ticket.channel || ticket.channel.type !== "RECLAMEAQUI" || !ticket.channel.isActive) {
    throw new Error(`Ticket ${ticketId} has no active RECLAMEAQUI channel`);
  }

  const config = decryptConfig(
    ticket.channel.config as Record<string, unknown>
  ) as unknown as RaClientConfig;

  if (!config.clientId || !config.clientSecret || !config.baseUrl) {
    throw new Error(`Channel ${ticket.channel.id} missing RA credentials`);
  }

  const client = new ReclameAquiClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    baseUrl: config.baseUrl,
  });

  return { ticket, raExternalId: ticket.raExternalId, client };
}

/**
 * Checks if a ReclameAquiError is a duplicate message error (code 40930).
 */
function isDuplicateError(err: unknown): boolean {
  return err instanceof ReclameAquiError && err.code === 40930;
}

/**
 * Creates a TicketMessage record for outbound actions.
 */
async function createOutboundMessage(params: {
  ticketId: string;
  content: string;
  isInternal: boolean;
  deliveryStatus: MessageDeliveryStatus;
}) {
  return prisma.ticketMessage.create({
    data: {
      ticketId: params.ticketId,
      senderId: null,
      content: params.content,
      channel: "RECLAMEAQUI",
      direction: "OUTBOUND",
      origin: "SYSTEM",
      isInternal: params.isInternal,
      deliveryStatus: params.deliveryStatus,
    },
  });
}

// ---------------------------------------------------------------------------
// Job Handlers
// ---------------------------------------------------------------------------

async function handleSendPublic(ticketId: string, message: string): Promise<void> {
  const { ticket, raExternalId, client } = await getTicketWithRaChannel(ticketId);

  try {
    await client.authenticate();
    await client.sendPublicMessage(raExternalId, message);

    await createOutboundMessage({
      ticketId: ticket.id,
      content: message,
      isInternal: false,
      deliveryStatus: "SENT",
    });

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "WAITING_CLIENT" },
    });

    logger.info(`[reclameaqui-outbound] Public message sent for ticket ${ticket.id}`);
  } catch (err) {
    if (isDuplicateError(err)) {
      await createOutboundMessage({
        ticketId: ticket.id,
        content: message,
        isInternal: false,
        deliveryStatus: "SENT",
      });
      logger.warn(`[reclameaqui-outbound] Duplicate public message for ticket ${ticket.id}, marked as SENT`);
      return;
    }

    await createOutboundMessage({
      ticketId: ticket.id,
      content: message,
      isInternal: false,
      deliveryStatus: "FAILED",
    }).catch(() => {}); // Don't mask original error

    logger.error(
      { error: err instanceof ReclameAquiError ? { code: err.code, message: err.message } : String(err) },
      `[reclameaqui-outbound] Failed to send public message for ticket ${ticket.id}`
    );
    throw err;
  }
}

async function handleSendPrivate(ticketId: string, message: string, email: string): Promise<void> {
  const { ticket, raExternalId, client } = await getTicketWithRaChannel(ticketId);

  try {
    await client.authenticate();
    await client.sendPrivateMessage(raExternalId, message, email);

    await createOutboundMessage({
      ticketId: ticket.id,
      content: message,
      isInternal: true,
      deliveryStatus: "SENT",
    });

    logger.info(`[reclameaqui-outbound] Private message sent for ticket ${ticket.id}`);
  } catch (err) {
    if (isDuplicateError(err)) {
      await createOutboundMessage({
        ticketId: ticket.id,
        content: message,
        isInternal: true,
        deliveryStatus: "SENT",
      });
      logger.warn(`[reclameaqui-outbound] Duplicate private message for ticket ${ticket.id}, marked as SENT`);
      return;
    }

    await createOutboundMessage({
      ticketId: ticket.id,
      content: message,
      isInternal: true,
      deliveryStatus: "FAILED",
    }).catch(() => {});

    logger.error(
      { error: err instanceof ReclameAquiError ? { code: err.code, message: err.message } : String(err) },
      `[reclameaqui-outbound] Failed to send private message for ticket ${ticket.id}`
    );
    throw err;
  }
}

async function handleSendDual(
  ticketId: string,
  privateMessage: string,
  publicMessage: string,
  email: string
): Promise<void> {
  const { ticket, raExternalId, client } = await getTicketWithRaChannel(ticketId);

  await client.authenticate();

  // 1. Send private message first
  let privateFailed = false;
  try {
    await client.sendPrivateMessage(raExternalId, privateMessage, email);

    await createOutboundMessage({
      ticketId: ticket.id,
      content: privateMessage,
      isInternal: true,
      deliveryStatus: "SENT",
    });

    logger.info(`[reclameaqui-outbound] Dual: private message sent for ticket ${ticket.id}`);
  } catch (err) {
    privateFailed = true;

    if (isDuplicateError(err)) {
      await createOutboundMessage({
        ticketId: ticket.id,
        content: privateMessage,
        isInternal: true,
        deliveryStatus: "SENT",
      });
      logger.warn(`[reclameaqui-outbound] Dual: duplicate private message for ticket ${ticket.id}, marked as SENT`);
      privateFailed = false;
    } else {
      await createOutboundMessage({
        ticketId: ticket.id,
        content: privateMessage,
        isInternal: true,
        deliveryStatus: "FAILED",
      }).catch(() => {});

      logger.error(
        { error: err instanceof ReclameAquiError ? { code: err.code, message: err.message } : String(err) },
        `[reclameaqui-outbound] Dual: failed to send private message for ticket ${ticket.id}`
      );
    }
  }

  // 2. Send public message (even if private failed)
  try {
    await client.sendPublicMessage(raExternalId, publicMessage);

    await createOutboundMessage({
      ticketId: ticket.id,
      content: publicMessage,
      isInternal: false,
      deliveryStatus: "SENT",
    });

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "WAITING_CLIENT" },
    });

    logger.info(`[reclameaqui-outbound] Dual: public message sent for ticket ${ticket.id}`);
  } catch (err) {
    if (isDuplicateError(err)) {
      await createOutboundMessage({
        ticketId: ticket.id,
        content: publicMessage,
        isInternal: false,
        deliveryStatus: "SENT",
      });
      logger.warn(`[reclameaqui-outbound] Dual: duplicate public message for ticket ${ticket.id}, marked as SENT`);
    } else {
      await createOutboundMessage({
        ticketId: ticket.id,
        content: publicMessage,
        isInternal: false,
        deliveryStatus: "FAILED",
      }).catch(() => {});

      logger.error(
        { error: err instanceof ReclameAquiError ? { code: err.code, message: err.message } : String(err) },
        `[reclameaqui-outbound] Dual: failed to send public message for ticket ${ticket.id}`
      );

      // Only throw if both failed
      if (privateFailed) {
        throw err;
      }
    }
  }
}

async function handleRequestEvaluation(ticketId: string): Promise<void> {
  const { ticket, raExternalId, client } = await getTicketWithRaChannel(ticketId);

  if (!ticket.raCanEvaluate) {
    logger.warn(`[reclameaqui-outbound] Ticket ${ticket.id} cannot request evaluation (raCanEvaluate=false)`);
    await createOutboundMessage({
      ticketId: ticket.id,
      content: "[Sistema] Solicitação de avaliação negada: ticket não permite avaliação",
      isInternal: true,
      deliveryStatus: "FAILED",
    });
    return;
  }

  try {
    await client.authenticate();
    await client.requestEvaluation(raExternalId);

    await createOutboundMessage({
      ticketId: ticket.id,
      content: "[Sistema] Avaliação solicitada ao consumidor",
      isInternal: true,
      deliveryStatus: "SENT",
    });

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { raCanEvaluate: false },
    });

    logger.info(`[reclameaqui-outbound] Evaluation requested for ticket ${ticket.id}`);
  } catch (err) {
    await createOutboundMessage({
      ticketId: ticket.id,
      content: `[Sistema] Falha ao solicitar avaliação: ${err instanceof ReclameAquiError ? err.message : "Erro desconhecido"}`,
      isInternal: true,
      deliveryStatus: "FAILED",
    }).catch(() => {});

    logger.error(
      { error: err instanceof ReclameAquiError ? { code: err.code, message: err.message } : String(err) },
      `[reclameaqui-outbound] Failed to request evaluation for ticket ${ticket.id}`
    );
    throw err;
  }
}

async function handleRequestModeration(
  ticketId: string,
  reason: number,
  message: string,
  migrateTO?: number
): Promise<void> {
  const { ticket, raExternalId, client } = await getTicketWithRaChannel(ticketId);

  try {
    await client.authenticate();
    await client.requestModeration(raExternalId, reason, message, migrateTO);

    await createOutboundMessage({
      ticketId: ticket.id,
      content: `[Sistema] Moderação solicitada (motivo: ${reason})${migrateTO ? ` — migrar para empresa ${migrateTO}` : ""}: ${message}`,
      isInternal: true,
      deliveryStatus: "SENT",
    });

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { raCanModerate: false },
    });

    logger.info(`[reclameaqui-outbound] Moderation requested for ticket ${ticket.id}, reason: ${reason}`);
  } catch (err) {
    await createOutboundMessage({
      ticketId: ticket.id,
      content: `[Sistema] Falha ao solicitar moderação: ${err instanceof ReclameAquiError ? err.message : "Erro desconhecido"}`,
      isInternal: true,
      deliveryStatus: "FAILED",
    }).catch(() => {});

    logger.error(
      { error: err instanceof ReclameAquiError ? { code: err.code, message: err.message } : String(err) },
      `[reclameaqui-outbound] Failed to request moderation for ticket ${ticket.id}`
    );
    throw err;
  }
}

async function handleFinishPrivate(ticketId: string): Promise<void> {
  const { ticket, raExternalId, client } = await getTicketWithRaChannel(ticketId);

  try {
    await client.authenticate();
    await client.finishPrivateMessage(raExternalId);

    await createOutboundMessage({
      ticketId: ticket.id,
      content: "[Sistema] Mensagem privada encerrada",
      isInternal: true,
      deliveryStatus: "SENT",
    });

    logger.info(`[reclameaqui-outbound] Private messaging finished for ticket ${ticket.id}`);
  } catch (err) {
    if (isDuplicateError(err)) {
      await createOutboundMessage({
        ticketId: ticket.id,
        content: "[Sistema] Mensagem privada encerrada (já encerrada anteriormente)",
        isInternal: true,
        deliveryStatus: "SENT",
      });
      logger.warn(`[reclameaqui-outbound] Duplicate finish private for ticket ${ticket.id}, marked as SENT`);
      return;
    }

    await createOutboundMessage({
      ticketId: ticket.id,
      content: `[Sistema] Falha ao encerrar mensagem privada: ${err instanceof ReclameAquiError ? err.message : "Erro desconhecido"}`,
      isInternal: true,
      deliveryStatus: "FAILED",
    }).catch(() => {});

    logger.error(
      { error: err instanceof ReclameAquiError ? { code: err.code, message: err.message } : String(err) },
      `[reclameaqui-outbound] Failed to finish private messaging for ticket ${ticket.id}`
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main Processor
// ---------------------------------------------------------------------------

export async function processReclameAquiOutbound(job: Job<RaOutboundJobData>): Promise<void> {
  const data = job.data;
  const jobType = job.name;

  logger.info(`[reclameaqui-outbound] Processing job ${job.id}: type=${jobType}, ticketId=${data.ticketId}`);

  switch (jobType) {
    case "RA_SEND_PUBLIC":
      return handleSendPublic(data.ticketId, (data as RaSendPublicJobData).message);

    case "RA_SEND_PRIVATE":
      return handleSendPrivate(
        data.ticketId,
        (data as RaSendPrivateJobData).message,
        (data as RaSendPrivateJobData).email
      );

    case "RA_SEND_DUAL":
      return handleSendDual(
        data.ticketId,
        (data as RaSendDualJobData).privateMessage,
        (data as RaSendDualJobData).publicMessage,
        (data as RaSendDualJobData).email
      );

    case "RA_REQUEST_EVALUATION":
      return handleRequestEvaluation(data.ticketId);

    case "RA_REQUEST_MODERATION":
      return handleRequestModeration(
        data.ticketId,
        (data as RaRequestModerationJobData).reason,
        (data as RaRequestModerationJobData).message,
        (data as RaRequestModerationJobData).migrateTO
      );

    case "RA_FINISH_PRIVATE":
      return handleFinishPrivate(data.ticketId);

    default:
      throw new Error(`[reclameaqui-outbound] Unknown job type: ${jobType}`);
  }
}
