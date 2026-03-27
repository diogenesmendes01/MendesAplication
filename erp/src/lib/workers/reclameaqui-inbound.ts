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
}

/** Prisma transaction client type */
type TxClient = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Status & Direction Mappers
// ---------------------------------------------------------------------------

/**
 * Maps Reclame Aqui ra_status.id to ERP TicketStatus.
 *
 *  5  (Não respondido)         → OPEN
 *  6  (Respondido)             → WAITING_CLIENT
 *  7  (Réplica consumidor)     → IN_PROGRESS
 *  8  (Réplica empresa)        → WAITING_CLIENT
 *  9  (Avaliado)               → RESOLVED
 * 10  (Congelado)              → CLOSED
 * 12  (Desativado consumidor)  → CLOSED
 * 13  (Inativa no RA)          → CLOSED
 * 18  (Avaliado Resolvido)     → RESOLVED
 * 19  (Avaliado Não Resolvido) → RESOLVED
 * 20  (Réplica)                → IN_PROGRESS
 */
function mapRaStatusToTicketStatus(raStatusId: number): TicketStatus {
  switch (raStatusId) {
    case 5:
      return "OPEN";
    case 6:
    case 8:
      return "WAITING_CLIENT";
    case 7:
    case 20:
      return "IN_PROGRESS";
    case 9:
    case 18:
    case 19:
      return "RESOLVED";
    case 10:
    case 12:
    case 13:
      return "CLOSED";
    default:
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

// ---------------------------------------------------------------------------
// Ticket Processing
// ---------------------------------------------------------------------------

async function processRaTicket(
  raTicket: RaTicket,
  companyId: string,
  channelId: string,
  summary: SyncSummary
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
    await createNewTicket(raTicket, companyId, channelId, ticketStatus, raStatusId, raStatusName);
    summary.created++;
  } else {
    await updateExistingTicket(existingTicket, raTicket, companyId, ticketStatus, raStatusId, raStatusName);
    summary.updated++;
  }
}

async function createNewTicket(
  raTicket: RaTicket,
  companyId: string,
  channelId: string,
  ticketStatus: TicketStatus,
  raStatusId: number,
  raStatusName: string
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
        tags: ["reclame-aqui"],
      },
    });

    // Create messages from interactions
    for (const interaction of raTicket.interactions) {
      await createTicketMessage(tx, ticket.id, interaction);
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
  raStatusName: string
): Promise<void> {
  const existingMessageIds = new Set(
    existingTicket.messages
      .map((m) => m.externalId)
      .filter((id): id is string => id !== null)
  );

  const newInteractions = raTicket.interactions.filter(
    (i) => !existingMessageIds.has(i.ticket_interaction_id)
  );

  // Update ticket RA fields
  await prisma.ticket.update({
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
    },
  });

  // Create new messages
  for (const interaction of newInteractions) {
    try {
      await createTicketMessage(prisma, existingTicket.id, interaction);
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
  interaction: RaInteraction
): Promise<void> {
  const direction = mapInteractionDirection(
    interaction.ticket_interaction_type_id
  );
  const isInternal = interaction.privacy === "true" || interaction.privacy === "1" || interaction.privacy === true;
  const content = buildMessageContent(interaction);

  await tx.ticketMessage.create({
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
}

// ---------------------------------------------------------------------------
// Main Processor
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function processReclameAquiInbound(_job: Job): Promise<void> {
  // Find all active RECLAMEAQUI channels
  const channels = await prisma.channel.findMany({
    where: { type: "RECLAMEAQUI", isActive: true },
    select: { id: true, companyId: true, config: true },
  });

  if (channels.length === 0) {
    logger.info("[reclameaqui-inbound] No active RECLAMEAQUI channels found");
    return;
  }

  for (const ch of channels) {
    const summary: SyncSummary = { total: 0, created: 0, updated: 0, errors: 0 };

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

    const lastSyncDate = config.lastSyncDate || defaultSyncDate();

    try {
      // Authenticate
      await client.authenticate();

      // Paginate through all tickets modified since last sync
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
            await processRaTicket(raTicket, ch.companyId, ch.id, summary);
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
