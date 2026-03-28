import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { decryptConfig } from "@/lib/encryption";
import { aiAgentQueue } from "@/lib/queue";
import { ReclameAquiClient } from "@/lib/reclameaqui/client";
import { logger } from "@/lib/logger";
import type { TicketStatus, MessageDirection, Prisma } from "@prisma/client";
import type {
  RaClientConfig,
  RaTicket,
  RaInteraction,
  RaInteractionDetail,
} from "@/lib/reclameaqui/types";
import {
  RA_INTERACTION_TYPES,
  RA_DETAIL_TYPES,
} from "@/lib/reclameaqui/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReclameAquiChannelConfig extends RaClientConfig {
  lastSyncDate?: string; // ISO 8601
}

interface SyncSummary {
  total: number;
  created: number;
  updated: number;
  errors: number;
  skippedByCount: boolean;
}

/** Prisma transaction client type */
type TxClient = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Status & Direction Mappers
// ---------------------------------------------------------------------------

/**
 * Maps Reclame Aqui ra_status.id to ERP TicketStatus.
 *
 * All 13 documented RA status IDs:
 *  5  (Não respondido)         → OPEN
 *  6  (Respondido)             → WAITING_CLIENT
 *  7  (Réplica consumidor)     → IN_PROGRESS
 *  8  (Réplica empresa)        → IN_PROGRESS
 *  9  (Avaliado)               → RESOLVED
 * 10  (Congelado)              → CLOSED
 * 11  (Moderação)              → IN_PROGRESS
 * 12  (Desativado consumidor)  → CLOSED
 * 13  (Inativa no RA)          → CLOSED
 * 17  (Redistribuição)         → CLOSED
 * 18  (Avaliado Resolvido)     → RESOLVED
 * 19  (Avaliado Não Resolvido) → RESOLVED
 * 20  (Réplica pendente)       → IN_PROGRESS
 */
export function mapRaStatusToTicketStatus(raStatusId: number): TicketStatus {
  switch (raStatusId) {
    case 5:
      return "OPEN";
    case 6:
      return "WAITING_CLIENT";
    case 7:
    case 8:
    case 11:
    case 20:
      return "IN_PROGRESS";
    case 9:
    case 18:
    case 19:
      return "RESOLVED";
    case 10:
    case 12:
    case 13:
    case 17:
      return "CLOSED";
    default:
      logger.warn({ raStatusId }, "[reclameaqui] Unknown RA status ID, defaulting to OPEN");
      return "OPEN";
  }
}

/**
 * Maps RA interaction type_id to ERP MessageDirection.
 *
 * INBOUND (consumer → company):  1, 6, 7, 11
 * OUTBOUND (company → consumer): 2, 3, 4, 5, 8, 9, 10, 151
 *
 * Type 151 (auto-moderation) is system-generated → treated as OUTBOUND.
 */
function mapInteractionDirection(typeId: number): MessageDirection {
  const inboundTypes = new Set<number>([
    RA_INTERACTION_TYPES.MANIFESTACAO,
    RA_INTERACTION_TYPES.MENSAGEM_PRIVADA_CONSUMIDOR,
    RA_INTERACTION_TYPES.COMENTARIO_TERCEIRO,
    RA_INTERACTION_TYPES.AVALIACAO,
  ]);
  return inboundTypes.has(typeId) ? "INBOUND" : "OUTBOUND";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultSyncDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

/**
 * Resolve the last sync date for a channel.
 * Priority: DB lastSyncAt > config.lastSyncDate > 7 days ago.
 */
function resolveLastSyncDate(
  dbLastSyncAt: Date | null,
  configLastSyncDate?: string
): string {
  if (dbLastSyncAt) return dbLastSyncAt.toISOString();
  return configLastSyncDate || defaultSyncDate();
}

/**
 * Builds the message content for an interaction, handling auto-moderation
 * (type 151) by prefixing with [Auto-Moderação] and appending the
 * moderated title from detail_type 40 if present.
 */
function buildMessageContent(interaction: RaInteraction): string {
  const typeId = interaction.ticket_interaction_type_id;
  let content = interaction.message || "";

  if (typeId === RA_INTERACTION_TYPES.AUTO_MODERACAO) {
    // Extract moderated title from details (detail_type_id = 40)
    const moderatedTitleDetail = interaction.details?.find(
      (d) => d.ticket_detail_type_id === RA_DETAIL_TYPES.TITULO_MODERADO
    );

    const parts: string[] = [`[Auto-Moderação] ${content}`];
    if (moderatedTitleDetail?.value) {
      parts.push(`Título moderado: ${moderatedTitleDetail.value}`);
    }
    content = parts.join("\n");
  }

  return content;
}

/**
 * Guess MIME type from file name extension.
 */
function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "mp4":
      return "video/mp4";
    case "mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// Attachment Processing
// ---------------------------------------------------------------------------

/**
 * Sync ticket-level attachments from RA `attached[]` array.
 * Deduplicates by externalId to avoid duplicates on re-syncs.
 */
async function syncTicketAttachments(
  tx: TxClient,
  ticketId: string,
  raTicket: RaTicket
): Promise<void> {
  if (!raTicket.attached?.length) return;

  for (const att of raTicket.attached) {
    const extId = att.id?.toString();
    if (!extId) continue;

    // Deduplicate by externalId
    const existing = await tx.attachment.findFirst({
      where: { ticketId, externalId: extId },
      select: { id: true },
    });

    if (existing) continue;

    const fileName = att.name || `attachment-${att.id}`;
    await tx.attachment.create({
      data: {
        ticketId,
        fileName,
        fileSize: 0, // RA doesn't return file size
        mimeType: guessMimeType(fileName),
        storagePath: null, // External attachment — no local storage
        externalId: extId,
        externalUrl: att.detail_description || "",
      },
    });
  }
}

/**
 * Sync interaction-level attachments (detail_type 15 = ANEXO, 33 = ANEXO_2)
 * as Attachments linked to the TicketMessage.
 */
async function syncInteractionAttachments(
  tx: TxClient,
  ticketId: string,
  messageId: string,
  details: RaInteractionDetail[],
  raClient?: ReclameAquiClient
): Promise<void> {
  if (!details?.length) return;

  const attachmentDetails = details.filter(
    (d) =>
      d.ticket_detail_type_id === RA_DETAIL_TYPES.ANEXO ||
      d.ticket_detail_type_id === RA_DETAIL_TYPES.ANEXO_2
  );

  for (const detail of attachmentDetails) {
    const extId = detail.ticket_detail_id?.toString();
    if (!extId) continue;

    // Deduplicate by externalId
    const existing = await tx.attachment.findFirst({
      where: { ticketMessageId: messageId, externalId: extId },
      select: { id: true },
    });

    if (existing) continue;

    let url = detail.value || detail.name || "";

    // Fallback: if URL is empty, try fetching via API
    if (!url && raClient) {
      try {
        const linkResult = await raClient.getAttachmentLink(extId);
        url = linkResult?.url || "";
      } catch {
        logger.warn(
          `[reclameaqui-inbound] Failed to fetch attachment link for detail ${extId}`
        );
      }
    }

    if (!url) continue;

    const fileName = detail.name || `attachment-${extId}`;
    await tx.attachment.create({
      data: {
        ticketMessageId: messageId,
        ticketId,
        fileName,
        fileSize: 0,
        mimeType: guessMimeType(fileName),
        storagePath: null,
        externalId: extId,
        externalUrl: url,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Ticket Processing
// ---------------------------------------------------------------------------

async function processRaTicket(
  raTicket: RaTicket,
  companyId: string,
  channelId: string,
  summary: SyncSummary,
  raClient?: ReclameAquiClient
): Promise<void> {
  const externalId = raTicket.source_external_id;
  const raStatusId = raTicket.ra_status.id;
  const raStatusName = raTicket.ra_status.name;
  const ticketStatus = mapRaStatusToTicketStatus(raStatusId);

  // Check if ticket already exists
  const existingTicket = await prisma.ticket.findFirst({
    where: { companyId, raExternalId: externalId },
    select: {
      id: true,
      aiEnabled: true,
      messages: {
        where: { channel: "RECLAMEAQUI" },
        select: { externalId: true },
      },
    },
  });

  if (!existingTicket) {
    await createNewTicket(raTicket, companyId, channelId, ticketStatus, raStatusId, raStatusName, raClient);
    summary.created++;
  } else {
    await updateExistingTicket(existingTicket, raTicket, companyId, ticketStatus, raStatusId, raStatusName, raClient);
    summary.updated++;
  }
}

async function createNewTicket(
  raTicket: RaTicket,
  companyId: string,
  channelId: string,
  ticketStatus: TicketStatus,
  raStatusId: number,
  raStatusName: string,
  raClient?: ReclameAquiClient
): Promise<void> {
  const customer = raTicket.customer;
  const customerEmail = customer.email?.[0]?.trim().toLowerCase();
  const customerPhone = customer.phone_numbers?.[0] || null;
  const customerCpf = customer.cpf?.[0] || null;

  await prisma.$transaction(async (tx) => {
    // Upsert client
    let clientId: string;

    if (customerEmail) {
      const existingClient = await tx.client.findFirst({
        where: { companyId, email: { equals: customerEmail, mode: "insensitive" } },
        select: { id: true },
      });

      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const cpfCnpj = customerCpf || `RA-${raTicket.source_external_id}`;
        const client = await tx.client.create({
          data: {
            name: customer.name || "Consumidor Reclame Aqui",
            cpfCnpj,
            email: customerEmail,
            telefone: customerPhone,
            type: "PF",
            companyId,
          },
        });
        clientId = client.id;
      }
    } else {
      const cpfCnpj = customerCpf || `RA-${raTicket.source_external_id}`;
      const existingClient = await tx.client.findFirst({
        where: { companyId, cpfCnpj },
        select: { id: true },
      });

      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const client = await tx.client.create({
          data: {
            name: customer.name || "Consumidor Reclame Aqui",
            cpfCnpj,
            telefone: customerPhone,
            type: "PF",
            companyId,
          },
        });
        clientId = client.id;
      }
    }

    // Create ticket
    const ticket = await tx.ticket.create({
      data: {
        clientId,
        companyId,
        channelId,
        subject: raTicket.complaint_title.substring(0, 200),
        description: raTicket.complaint_content,
        status: ticketStatus,
        priority: "HIGH",
        raExternalId: raTicket.source_external_id,
        raStatusId,
        raStatusName,
        raCanEvaluate: raTicket.request_evaluation ?? false,
        raCanModerate: raTicket.request_moderation ?? false,
        raRating: raTicket.rating,
        raResolvedIssue: raTicket.resolved_issue,
        raBackDoingBusiness: raTicket.back_doing_business,
        raFrozen: raStatusId === 10,
        raReason: raTicket.ra_reason ?? null,
        raFeeling: raTicket.ra_feeling ?? null,
        raCategories: raTicket.categories?.map(c => c.description) ?? [],
        raPublicTreatmentTime: raTicket.public_treatment_time ?? null,
        raPrivateTreatmentTime: raTicket.private_treatment_time ?? null,
        raRatingDate: raTicket.rating_date ? new Date(raTicket.rating_date) : null,
        raCommentsCount: raTicket.comments_count ?? 0,
        raUnreadCount: raTicket.interactions_not_readed_count ?? 0,
        raWhatsappEvalSent: raTicket.whatsapp?.sent ?? null,
        raWhatsappEvalDone: raTicket.whatsapp?.evaluated ?? null,
        raActive: raTicket.active ?? true,
        raModerationStatus: raTicket.moderation?.status ?? null,
        raConsumerConsideration: raTicket.consumer_consideration ?? null,
        raCompanyConsideration: raTicket.company_consideration ?? null,
        tags: ["reclame-aqui"],
      },
    });

    // Sync ticket-level attachments (attached[])
    await syncTicketAttachments(tx, ticket.id, raTicket);

    // Create messages from interactions (+ their attachments)
    for (const interaction of raTicket.interactions) {
      await createTicketMessage(tx, ticket.id, interaction, raClient);
    }

    logger.info(
      `[reclameaqui-inbound] Created ticket ${ticket.id} with ${raTicket.interactions.length} messages`
    );
  });
}

async function updateExistingTicket(
  existingTicket: {
    id: string;
    aiEnabled: boolean;
    messages: { externalId: string | null }[];
  },
  raTicket: RaTicket,
  companyId: string,
  ticketStatus: TicketStatus,
  raStatusId: number,
  raStatusName: string,
  raClient?: ReclameAquiClient
): Promise<void> {
  const existingMessageIds = new Set(
    existingTicket.messages
      .map((m) => m.externalId)
      .filter((id): id is string => id !== null)
  );

  const newInteractions = raTicket.interactions.filter(
    (i) => !existingMessageIds.has(i.ticket_interaction_id)
  );

  // Update ticket RA fields + sync ticket-level attachments
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: existingTicket.id },
      data: {
        status: ticketStatus,
        raStatusId,
        raStatusName,
        raCanEvaluate: raTicket.request_evaluation ?? false,
        raCanModerate: raTicket.request_moderation ?? false,
        raRating: raTicket.rating,
        raResolvedIssue: raTicket.resolved_issue,
        raBackDoingBusiness: raTicket.back_doing_business,
        raFrozen: raStatusId === 10,
        raReason: raTicket.ra_reason ?? null,
        raFeeling: raTicket.ra_feeling ?? null,
        raCategories: raTicket.categories?.map(c => c.description) ?? [],
        raPublicTreatmentTime: raTicket.public_treatment_time ?? null,
        raPrivateTreatmentTime: raTicket.private_treatment_time ?? null,
        raRatingDate: raTicket.rating_date ? new Date(raTicket.rating_date) : null,
        raCommentsCount: raTicket.comments_count ?? 0,
        raUnreadCount: raTicket.interactions_not_readed_count ?? 0,
        raWhatsappEvalSent: raTicket.whatsapp?.sent ?? null,
        raWhatsappEvalDone: raTicket.whatsapp?.evaluated ?? null,
        raActive: raTicket.active ?? true,
        raModerationStatus: raTicket.moderation?.status ?? null,
        raConsumerConsideration: raTicket.consumer_consideration ?? null,
        raCompanyConsideration: raTicket.company_consideration ?? null,
      },
    });

    // Sync ticket-level attachments (may have new ones on re-sync)
    await syncTicketAttachments(tx, existingTicket.id, raTicket);
  });

  // Create new messages
  for (const interaction of newInteractions) {
    try {
      await createTicketMessage(prisma, existingTicket.id, interaction, raClient);
    } catch (err: unknown) {
      // Handle unique constraint violation (idempotent)
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        logger.debug(
          `[reclameaqui-inbound] Duplicate message ${interaction.ticket_interaction_id}, skipping`
        );
        continue;
      }
      throw err;
    }

    // Enqueue AI agent for new inbound messages if AI is enabled
    const direction = mapInteractionDirection(
      interaction.ticket_interaction_type_id
    );
    if (direction === "INBOUND" && existingTicket.aiEnabled) {
      await aiAgentQueue.add("process-message", {
        ticketId: existingTicket.id,
        companyId,
        messageContent: interaction.message,
        channel: "RECLAMEAQUI" as const,
        raContext: {
          reason: raTicket.ra_reason ?? null,
          feeling: raTicket.ra_feeling ?? null,
          categories: raTicket.categories?.map((c: any) => c.description) ?? [],
          customerName: raTicket.customer?.name ?? null,
          complaintTitle: raTicket.complaint_title ?? null,
          previousResponseContent: raTicket.complaint_response_content ?? null,
          resolvedIssue: raTicket.resolved_issue ?? null,
          rating: raTicket.rating ?? null,
          interactionsCount: raTicket.interactions?.length ?? 0,
          isReplica: [7, 20].includes(raTicket.ra_status?.id ?? 0),
        },
      });
      logger.info(
        `[reclameaqui-inbound] Enqueued ai-agent job for ticket ${existingTicket.id}`
      );
    }
  }

  if (newInteractions.length > 0) {
    logger.info(
      `[reclameaqui-inbound] Updated ticket ${existingTicket.id}: ${newInteractions.length} new messages`
    );
  }
}

async function createTicketMessage(
  tx: TxClient,
  ticketId: string,
  interaction: RaInteraction,
  raClient?: ReclameAquiClient
): Promise<void> {
  const direction = mapInteractionDirection(
    interaction.ticket_interaction_type_id
  );
  const isInternal = interaction.privacy === "true" || interaction.privacy === "1" || interaction.privacy === true;
  const content = buildMessageContent(interaction);

  const message = await tx.ticketMessage.create({
    data: {
      ticketId,
      senderId: null,
      content,
      channel: "RECLAMEAQUI",
      direction,
      origin: "SYSTEM",
      externalId: interaction.ticket_interaction_id,
      isInternal,
      createdAt: interaction.creation_date
        ? new Date(interaction.creation_date)
        : new Date(),
    },
  });

  // Sync interaction-level attachments (detail_type 15/33)
  await syncInteractionAttachments(
    tx,
    ticketId,
    message.id,
    interaction.details,
    raClient
  );
}

// ---------------------------------------------------------------------------
// Count-First Check
// ---------------------------------------------------------------------------

/**
 * Performs a lightweight count check before full sync.
 * Returns the number of tickets modified since lastSyncDate.
 * Uses 1 API call instead of potentially many paginated GETs.
 *
 * With count-first, the cron interval can safely go from 15min → 5min
 * since most executions will only cost 1 API call (auth + count).
 */
async function countModifiedTickets(
  client: ReclameAquiClient,
  lastSyncDate: string
): Promise<number> {
  const countResponse = await client.countTickets({
    last_modification_date: {
      comparator: "gte",
      value: lastSyncDate,
    },
  });
  return countResponse.data ?? 0;
}

// ---------------------------------------------------------------------------
// Main Processor
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function processReclameAquiInbound(_job: Job): Promise<void> {
  // Find all active RECLAMEAQUI channels
  const channels = await prisma.channel.findMany({
    where: { type: "RECLAMEAQUI", isActive: true },
    select: { id: true, companyId: true, config: true, lastSyncAt: true },
  });

  if (channels.length === 0) {
    logger.info("[reclameaqui-inbound] No active RECLAMEAQUI channels found");
    return;
  }

  for (const ch of channels) {
    const summary: SyncSummary = { total: 0, created: 0, updated: 0, errors: 0, skippedByCount: false };

    let config: ReclameAquiChannelConfig;
    try {
      config = decryptConfig(
        ch.config as Record<string, unknown>
      ) as unknown as ReclameAquiChannelConfig;
    } catch (_err) {
      logger.error(
        `[reclameaqui-inbound] Failed to decrypt config for channel ${ch.id}`
      );
      continue;
    }

    if (!config.clientId || !config.clientSecret || !config.baseUrl) {
      logger.warn(
        `[reclameaqui-inbound] Channel ${ch.id} missing RA credentials, skipping`
      );
      continue;
    }

    const client = new ReclameAquiClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      baseUrl: config.baseUrl,
    });

    // Check ticket API availability before sync
    const isAvailable = await client.checkTicketAvailability();
    if (!isAvailable) {
      logger.warn(`[reclameaqui-inbound] Ticket API indisponível, sync skipado para channel ${ch.id}`);
      continue;
    }

    // Resolve last sync date: DB field > config > 7 days ago
    const lastSyncDate = resolveLastSyncDate(ch.lastSyncAt, config.lastSyncDate);

    try {
      // Authenticate
      await client.authenticate();

      // ── Count-first check ──────────────────────────────────────
      // Before paginating, check if anything changed since last sync.
      // Costs 1 API call. If count = 0, skip full sync entirely.
      const modifiedCount = await countModifiedTickets(client, lastSyncDate);

      if (modifiedCount === 0) {
        logger.info(
          `[reclameaqui-inbound] No changes since ${lastSyncDate} for channel ${ch.id}, skipping sync`
        );
        summary.skippedByCount = true;

        // Still update lastSyncAt to advance the window
        const now = new Date();
        await prisma.channel.update({
          where: { id: ch.id },
          data: {
            lastSyncAt: now,
            config: {
              ...(ch.config as Record<string, unknown>),
              lastSyncDate: now.toISOString(),
            },
          },
        });
        continue;
      }

      logger.info(
        `[reclameaqui-inbound] ${modifiedCount} ticket(s) modified since ${lastSyncDate} for channel ${ch.id}, starting sync`
      );

      // ── Full sync (only when count > 0) ────────────────────────
      let pageNumber = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await client.getTickets({
          last_modification_date: {
            comparator: "gte",
            value: lastSyncDate,
          },
          page_size: 50,
          page_number: pageNumber,
          sort: "asc",
        });

        const tickets = response.data || [];
        summary.total += tickets.length;

        for (const raTicket of tickets) {
          try {
            await processRaTicket(raTicket, ch.companyId, ch.id, summary, client);
          } catch (_err) {
            summary.errors++;
            logger.error(
              `[reclameaqui-inbound] Error processing RA ticket ${raTicket.source_external_id}`
            );
          }
        }

        // Check if there are more pages
        const totalRecords = response.meta?.total ?? 0;
        const pageSize = response.meta?.page?.size ?? 50;
        const currentPage = response.meta?.page?.number ?? pageNumber;
        const totalPages = Math.ceil(totalRecords / pageSize);

        hasMore = currentPage < totalPages && tickets.length > 0;
        pageNumber++;
      }

      // Update channel sync state
      const now = new Date();
      await prisma.channel.update({
        where: { id: ch.id },
        data: {
          lastSyncAt: now,
          config: {
            ...(ch.config as Record<string, unknown>),
            lastSyncDate: now.toISOString(),
          },
        },
      });

      logger.info(
        `[reclameaqui-inbound] Sync complete for channel ${ch.id}: ` +
          `total=${summary.total}, created=${summary.created}, ` +
          `updated=${summary.updated}, errors=${summary.errors}`
      );
    } catch (_err) {
      logger.error(
        `[reclameaqui-inbound] Error syncing channel ${ch.id}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Exported for testing
// ---------------------------------------------------------------------------

export {
  countModifiedTickets as _countModifiedTickets,
  resolveLastSyncDate as _resolveLastSyncDate,
  mapRaStatusToTicketStatus as _mapRaStatusToTicketStatus,
  mapInteractionDirection as _mapInteractionDirection,
};
