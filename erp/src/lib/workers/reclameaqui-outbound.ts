import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { decryptConfig } from "@/lib/encryption";
import { ReclameAquiClient, ReclameAquiError } from "@/lib/reclameaqui/client";
import { logger } from "@/lib/logger";
import { sseBus } from "@/lib/sse";
import type { RaClientConfig } from "@/lib/reclameaqui/types";
import type { MessageDeliveryStatus } from "@prisma/client";
import { promises as fs } from "fs";

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
  filePaths?: string[]; // paths to files saved on disk
  files?: string[]; // base64-encoded file buffers (legacy, backward compat)
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
  filePaths?: string[]; // paths to files saved on disk
  files?: string[]; // base64-encoded file buffers (legacy, backward compat)
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
// Error Classification
// ---------------------------------------------------------------------------

/**
 * RA error codes that are RETRIABLE (transient failures).
 * Rate limit (429), server errors (500, 503).
 */
const RETRIABLE_ERROR_CODES = new Set([4290, 5000, 5030]);

/**
 * RA error codes that are PERMANENT (no point retrying).
 * Ticket inactive, already rated, moderation already requested, etc.
 */
const PERMANENT_ERROR_CODES = new Set([
  4090,   // Ticket inactive
  4091,   // Not RA ticket
  4095,   // Already rated
  4096,   // Not eligible for evaluation
  4098,   // Attachment limit exceeded
  4099,   // Daily moderation limit exceeded
  40910,  // Moderation per complaint limit exceeded
  40912,  // Moderation by duplicity impossible
  40913,  // Moderation requires public response + evaluation
  40914,  // Moderation reason not allowed
  40915,  // Not RA ticket
  40916,  // Already has pending moderation
  40917,  // Moderation already requested
  40919,  // Source doesn't support private messages
  40920,  // Ticket closed, public message blocked
  40922,  // Unsupported attachment type
  40925,  // Private message already finished
  40930,  // Duplicate message (handled separately)
]);

/**
 * Classifies an error as retriable or permanent.
 * - Network errors (no code) → retriable
 * - Known transient codes → retriable
 * - Known permanent codes → permanent
 * - Unknown codes → retriable (safer to retry)
 */
export function isRetriableError(err: unknown): boolean {
  if (!(err instanceof ReclameAquiError)) {
    // Network errors, timeouts, etc → retry
    return true;
  }

  if (PERMANENT_ERROR_CODES.has(err.code)) {
    return false;
  }

  if (RETRIABLE_ERROR_CODES.has(err.code)) {
    return true;
  }

  // Unknown RA error code → default to retriable
  return true;
}

/**
 * Custom error for permanent failures that should NOT be retried by BullMQ.
 * We catch the original error and wrap it so we can return instead of throw.
 */
class PermanentRaError extends Error {
  public readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "PermanentRaError";
    this.code = code;
  }
}

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
      company: {
        select: { id: true },
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

  return { ticket, raExternalId: ticket.raExternalId, client, companyId: ticket.company?.id ?? ticket.companyId };
}

/**
 * Checks if a ReclameAquiError is a duplicate message error (code 40930).
 */
function isDuplicateError(err: unknown): boolean {
  return err instanceof ReclameAquiError && err.code === 40930;
}

/**
 * Reads file buffers from disk paths. Falls back to base64 decoding for legacy jobs.
 */
async function resolveFileBuffers(
  filePaths?: string[],
  filesBase64?: string[]
): Promise<Buffer[] | undefined> {
  // New format: read from disk
  if (filePaths && filePaths.length > 0) {
    return Promise.all(filePaths.map((p) => fs.readFile(p)));
  }
  // Legacy format: decode base64
  if (filesBase64 && filesBase64.length > 0) {
    return filesBase64.map((f) => Buffer.from(f, "base64"));
  }
  return undefined;
}

/**
 * Cleans up temporary files from disk. Silently ignores missing files.
 */
async function cleanupFiles(filePaths?: string[]): Promise<void> {
  if (!filePaths || filePaths.length === 0) return;
  await Promise.all(filePaths.map((p) => fs.unlink(p).catch(() => {})));
  // Try to remove the parent directory if empty
  if (filePaths.length > 0) {
    const dir = filePaths[0].substring(0, filePaths[0].lastIndexOf("/"));
    await fs.rmdir(dir).catch(() => {});
  }
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

/**
 * Structured log for outbound job attempts.
 */
function logJobAttempt(params: {
  jobType: string;
  ticketId: string;
  attempt: number;
  maxAttempts: number;
  error: unknown;
  willRetry: boolean;
}) {
  const errorInfo = params.error instanceof ReclameAquiError
    ? { code: params.error.code, message: params.error.message }
    : { message: String(params.error) };

  logger.error(
    {
      jobType: params.jobType,
      ticketId: params.ticketId,
      attempt: params.attempt,
      maxAttempts: params.maxAttempts,
      error: errorInfo,
      willRetry: params.willRetry,
    },
    `[reclameaqui-outbound] Job failed: ${params.jobType} for ticket ${params.ticketId} (attempt ${params.attempt}/${params.maxAttempts}, willRetry=${params.willRetry})`
  );
}

/**
 * Notify the frontend via SSE that a timeline update happened.
 */
function notifyTimelineUpdate(companyId: string, ticketId: string) {
  sseBus.publish(`company:${companyId}:sac`, "timeline-update", {
    ticketId,
    timestamp: Date.now(),
  });
}

/**
 * Handles an error in an outbound job:
 * - Duplicate → mark as SENT, return (no throw)
 * - Permanent → create FAILED message, return (no throw = BullMQ won't retry)
 * - Retriable → create FAILED message only on last attempt, throw (BullMQ retries)
 */
async function handleOutboundError(params: {
  err: unknown;
  job: Job;
  ticketId: string;
  companyId: string;
  content: string;
  isInternal: boolean;
  onDuplicate?: () => Promise<void>;
}): Promise<void> {
  const { err, job, ticketId, companyId, content, isInternal, onDuplicate } = params;
  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts?.attempts ?? 3;

  // Duplicate → treat as success
  if (isDuplicateError(err)) {
    await createOutboundMessage({
      ticketId,
      content,
      isInternal,
      deliveryStatus: "SENT",
    });
    logger.warn(`[reclameaqui-outbound] Duplicate message for ticket ${ticketId}, marked as SENT`);
    if (onDuplicate) await onDuplicate();
    return;
  }

  const retriable = isRetriableError(err);
  const isLastAttempt = attempt >= maxAttempts;
  const willRetry = retriable && !isLastAttempt;

  logJobAttempt({
    jobType: job.name,
    ticketId,
    attempt,
    maxAttempts,
    error: err,
    willRetry,
  });

  if (!retriable) {
    // Permanent error → create FAILED message, don't throw (BullMQ won't retry)
    await createOutboundMessage({
      ticketId,
      content,
      isInternal,
      deliveryStatus: "FAILED",
    }).catch(() => {});

    notifyTimelineUpdate(companyId, ticketId);
    return;
  }

  // Retriable error
  if (isLastAttempt) {
    // Last attempt → create FAILED message + notify
    await createOutboundMessage({
      ticketId,
      content,
      isInternal,
      deliveryStatus: "FAILED",
    }).catch(() => {});

    notifyTimelineUpdate(companyId, ticketId);
  }

  // Throw so BullMQ retries (or marks as failed on last attempt)
  throw err;
}

// ---------------------------------------------------------------------------
// Job Handlers
// ---------------------------------------------------------------------------

async function handleSendPublic(job: Job, ticketId: string, message: string): Promise<void> {
  const { ticket, raExternalId, client, companyId } = await getTicketWithRaChannel(ticketId);

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
    await handleOutboundError({
      err,
      job,
      ticketId: ticket.id,
      companyId,
      content: message,
      isInternal: false,
    });
  }
}

async function handleSendPrivate(
  job: Job,
  ticketId: string,
  message: string,
  email: string,
  filePaths?: string[],
  filesBase64?: string[]
): Promise<void> {
  const { ticket, raExternalId, client, companyId } = await getTicketWithRaChannel(ticketId);

  try {
    await client.authenticate();
    // Read files from disk (new) or decode base64 (legacy backward compat)
    const fileBuffers = await resolveFileBuffers(filePaths, filesBase64);
    await client.sendPrivateMessage(raExternalId, message, email, fileBuffers);

    await createOutboundMessage({
      ticketId: ticket.id,
      content: message,
      isInternal: true,
      deliveryStatus: "SENT",
    });

    logger.info(`[reclameaqui-outbound] Private message sent for ticket ${ticket.id}`);
  } catch (err) {
    await handleOutboundError({
      err,
      job,
      ticketId: ticket.id,
      companyId,
      content: message,
      isInternal: true,
    });
  } finally {
    // Always cleanup disk files, even on failure
    await cleanupFiles(filePaths);
  }
}

async function handleSendDual(
  job: Job,
  ticketId: string,
  privateMessage: string,
  publicMessage: string,
  email: string
): Promise<void> {
  const { ticket, raExternalId, client, companyId } = await getTicketWithRaChannel(ticketId);

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
      const retriable = isRetriableError(err);
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts?.attempts ?? 3;

      logJobAttempt({
        jobType: job.name,
        ticketId: ticket.id,
        attempt,
        maxAttempts,
        error: err,
        willRetry: retriable && attempt < maxAttempts,
      });

      if (!retriable || attempt >= maxAttempts) {
        await createOutboundMessage({
          ticketId: ticket.id,
          content: privateMessage,
          isInternal: true,
          deliveryStatus: "FAILED",
        }).catch(() => {});
      }
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
      const retriable = isRetriableError(err);
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts?.attempts ?? 3;
      const willRetry = retriable && attempt < maxAttempts;

      logJobAttempt({
        jobType: job.name,
        ticketId: ticket.id,
        attempt,
        maxAttempts,
        error: err,
        willRetry,
      });

      if (!retriable || attempt >= maxAttempts) {
        await createOutboundMessage({
          ticketId: ticket.id,
          content: publicMessage,
          isInternal: false,
          deliveryStatus: "FAILED",
        }).catch(() => {});

        notifyTimelineUpdate(companyId, ticket.id);
      }

      // Only throw if both failed (retriable) — or if public failed and should retry
      if (privateFailed || willRetry) {
        throw err;
      }
    }
  }

  // If private failed with a retriable error and public succeeded, still notify
  if (privateFailed) {
    notifyTimelineUpdate(companyId, ticket.id);
  }
}

async function handleRequestEvaluation(job: Job, ticketId: string): Promise<void> {
  const { ticket, raExternalId, client, companyId } = await getTicketWithRaChannel(ticketId);

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
    await handleOutboundError({
      err,
      job,
      ticketId: ticket.id,
      companyId,
      content: `[Sistema] Falha ao solicitar avaliação: ${err instanceof ReclameAquiError ? err.message : "Erro desconhecido"}`,
      isInternal: true,
    });
  }
}

async function handleRequestModeration(
  job: Job,
  ticketId: string,
  reason: number,
  message: string,
  migrateTO?: number,
  filePaths?: string[],
  filesBase64?: string[]
): Promise<void> {
  const { ticket, raExternalId, client, companyId } = await getTicketWithRaChannel(ticketId);

  try {
    await client.authenticate();
    // Read files from disk (new) or decode base64 (legacy backward compat)
    const modFileBuffers = await resolveFileBuffers(filePaths, filesBase64);
    await client.requestModeration(raExternalId, reason, message, migrateTO, modFileBuffers);

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
    await handleOutboundError({
      err,
      job,
      ticketId: ticket.id,
      companyId,
      content: `[Sistema] Falha ao solicitar moderação: ${err instanceof ReclameAquiError ? err.message : "Erro desconhecido"}`,
      isInternal: true,
    });
  } finally {
    // Always cleanup disk files, even on failure
    await cleanupFiles(filePaths);
  }
}

async function handleFinishPrivate(job: Job, ticketId: string): Promise<void> {
  const { ticket, raExternalId, client, companyId } = await getTicketWithRaChannel(ticketId);

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
    await handleOutboundError({
      err,
      job,
      ticketId: ticket.id,
      companyId,
      content: `[Sistema] Falha ao encerrar mensagem privada: ${err instanceof ReclameAquiError ? err.message : "Erro desconhecido"}`,
      isInternal: true,
      onDuplicate: async () => {
        await createOutboundMessage({
          ticketId: ticket.id,
          content: "[Sistema] Mensagem privada encerrada (já encerrada anteriormente)",
          isInternal: true,
          deliveryStatus: "SENT",
        });
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Main Processor
// ---------------------------------------------------------------------------

export async function processReclameAquiOutbound(job: Job<RaOutboundJobData>): Promise<void> {
  const data = job.data;
  const jobType = job.name;
  const startTime = Date.now();

  logger.info(
    { jobType, ticketId: data.ticketId, attempt: job.attemptsMade + 1, maxAttempts: job.opts?.attempts ?? 3 },
    `[reclameaqui-outbound] Processing job ${job.id}: type=${jobType}, ticketId=${data.ticketId}, attempt=${job.attemptsMade + 1}`
  );

export async function processReclameAquiOutbound(job: Job<RaOutboundJobData>): Promise<void> {
  const data = job.data;
  const jobType = job.name;
  const startTime = Date.now();

  logger.info(
    { jobType, ticketId: data.ticketId, attempt: job.attemptsMade + 1, maxAttempts: job.opts?.attempts ?? 3 },
    `[reclameaqui-outbound] Processing job ${job.id}: type=${jobType}, ticketId=${data.ticketId}, attempt=${job.attemptsMade + 1}`
  );

  try {
    switch (jobType) {
      case "RA_SEND_PUBLIC":
        await handleSendPublic(job, data.ticketId, (data as RaSendPublicJobData).message);
        break;

      case "RA_SEND_PRIVATE":
        await handleSendPrivate(
          job,
          data.ticketId,
          (data as RaSendPrivateJobData).message,
          (data as RaSendPrivateJobData).email,
          (data as RaSendPrivateJobData).filePaths,
          (data as RaSendPrivateJobData).files
        );
        break;

      case "RA_SEND_DUAL":
        await handleSendDual(
          job,
          data.ticketId,
          (data as RaSendDualJobData).privateMessage,
          (data as RaSendDualJobData).publicMessage,
          (data as RaSendDualJobData).email
        );
        break;

      case "RA_REQUEST_EVALUATION":
        await handleRequestEvaluation(job, data.ticketId);
        break;

      case "RA_REQUEST_MODERATION":
        await handleRequestModeration(
          job,
          data.ticketId,
          (data as RaRequestModerationJobData).reason,
          (data as RaRequestModerationJobData).message,
          (data as RaRequestModerationJobData).migrateTO,
          (data as RaRequestModerationJobData).filePaths,
          (data as RaRequestModerationJobData).files
        );
        break;

      case "RA_FINISH_PRIVATE":
        await handleFinishPrivate(job, data.ticketId);
        break;

      default:
        throw new Error(`[reclameaqui-outbound] Unknown job type: ${jobType}`);
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        event: "ra_outbound_completed",
        jobType,
        ticketId: data.ticketId,
        durationMs,
        attempt: job.attemptsMade + 1,
      },
      `[reclameaqui-outbound] Job ${job.id} completed`
    );
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error(
      {
        event: "ra_outbound_failed",
        jobType,
        ticketId: data.ticketId,
        attempts: job.attemptsMade + 1,
        error: err instanceof Error ? err.message : String(err),
        code: err instanceof ReclameAquiError ? err.code : undefined,
      },
      `[reclameaqui-outbound] Job ${job.id} failed`
    );
    throw err;
  }
}
