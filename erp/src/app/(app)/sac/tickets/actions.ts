"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { getSlaStatus, type SlaStatusValue } from "@/lib/sla";
import { Prisma, type TicketStatus, type TicketPriority, type ChannelType, type MessageDirection, type MessageOrigin, type RefundStatus } from "@prisma/client";
import { getSharedCompanyIds } from "@/lib/shared-clients";
import { createTaxEntriesForInvoice } from "@/lib/tax-entries";
import { getCachedFiscalConfig } from "@/app/(app)/configuracoes/fiscal/actions";
import type { JwtPayload } from "@/lib/auth";
import { sseBus } from "@/lib/sse";
import { getCompanyKpis, invalidateKpiCache, fetchSlaConfigs } from "@/lib/kpi-cache";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type TicketTab = "all" | "sla_critical" | "refunds" | "my_tickets";

export interface ListTicketsParams {
  companyId: string;
  page?: number;
  pageSize?: number;
  tab?: TicketTab;
  search?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  clientId?: string;
  assigneeId?: string;
  channelType?: ChannelType;
  hasPendingSuggestion?: boolean;
}

export interface CreateTicketInput {
  companyId: string;
  clientId: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  assigneeId?: string;
  proposalId?: string;
  boletoId?: string;
}

export interface TicketRow {
  id: string;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  channelType: ChannelType | null;
  slaStatus: SlaStatusValue | null;
  slaTimeLeft: string | null;
  tags: string[];
  client: {
    id: string;
    name: string;
  };
  assignee: {
    id: string;
    name: string;
  } | null;
  raExternalId: string | null;
  raStatusName: string | null;
  raRating: string | null;
  hasPendingSuggestion: boolean;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

async function _listTicketsInternal(
  params: ListTicketsParams,
  session: JwtPayload
): Promise<PaginatedResult<TicketRow>> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where: Prisma.TicketWhereInput = {
    companyId: params.companyId,
  };

  // Tab-based filtering
  const tab = params.tab ?? "all";
  switch (tab) {
    case "sla_critical":
      where.OR = [
        { slaBreached: true },
        {
          slaResolution: { not: null, lte: new Date(Date.now() + 30 * 60_000) },
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
        {
          slaFirstReply: { not: null, lte: new Date(Date.now() + 30 * 60_000) },
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      ];
      break;
    case "refunds":
      where.refunds = { some: {} };
      break;
    case "my_tickets":
      where.assigneeId = session.userId;
      break;
  }

  // Text search across client name and subject
  if (params.search) {
    const searchFilter: Prisma.TicketWhereInput = {
      OR: [
        { subject: { contains: params.search, mode: "insensitive" } },
        { client: { name: { contains: params.search, mode: "insensitive" } } },
      ],
    };
    if (where.OR) {
      // Combine with existing OR from tab filter using AND
      where.AND = [{ OR: where.OR }, searchFilter];
      delete where.OR;
    } else {
      where.AND = [searchFilter];
    }
  }

  if (params.status) {
    where.status = params.status;
  }
  if (params.priority) {
    where.priority = params.priority;
  }
  if (params.clientId) {
    where.clientId = params.clientId;
  }
  if (params.assigneeId && tab !== "my_tickets") {
    where.assigneeId = params.assigneeId;
  }
  if (params.channelType) {
    where.channel = { type: params.channelType };
  }

  // Fetch SLA alert configs for at-risk calculation (cached)
  const slaConfigs = await fetchSlaConfigs(params.companyId);
  const alertMinutesMap: Record<string, number> = {};
  for (const c of slaConfigs) {
    if (c.priority && c.stage) {
      alertMinutesMap[`${c.priority}_${c.stage}`] = c.alertBeforeMinutes;
    }
  }

  const [rows, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        client: {
          select: { id: true, name: true },
        },
        assignee: {
          select: { id: true, name: true },
        },
        channel: {
          select: { type: true },
        },
        _count: {
          select: {
            messages: {
              where: {
                isAiGenerated: true,
                deliveryStatus: "PENDING_APPROVAL",
              },
            },
          },
        },
      },
    }),
    prisma.ticket.count({ where }),
  ]);

  const data: TicketRow[] = rows.map((r) => {
    // Determine SLA status based on resolution deadline
    let slaStatus: SlaStatusValue | null = null;
    let slaTimeLeft: string | null = null;
    const deadline = r.slaResolution ?? r.slaFirstReply;
    if (deadline && !["RESOLVED", "CLOSED"].includes(r.status)) {
      const alertKey = `${r.priority}_resolution`;
      const alertMinutes = alertMinutesMap[alertKey] ?? 30;
      slaStatus = getSlaStatus(deadline, alertMinutes);
      const diffMs = deadline.getTime() - Date.now();
      if (diffMs <= 0) {
        const overMs = Math.abs(diffMs);
        const overH = Math.floor(overMs / 3_600_000);
        const overM = Math.floor((overMs % 3_600_000) / 60_000);
        slaTimeLeft = `-${overH}h${String(overM).padStart(2, "0")}m`;
      } else {
        const h = Math.floor(diffMs / 3_600_000);
        const m = Math.floor((diffMs % 3_600_000) / 60_000);
        slaTimeLeft = `${h}h${String(m).padStart(2, "0")}m`;
      }
    } else if (r.slaBreached) {
      slaStatus = "breached";
      slaTimeLeft = "Estourado";
    }

    return {
      id: r.id,
      subject: r.subject,
      priority: r.priority,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      channelType: r.channel?.type ?? null,
      slaStatus,
      slaTimeLeft,
      tags: r.tags,
      client: r.client,
      assignee: r.assignee,
      raExternalId: r.raExternalId ?? null,
      raStatusName: r.raStatusName ?? null,
      raRating: r.raRating ?? null,
      hasPendingSuggestion: (r._count?.messages ?? 0) > 0,
    };
  });

  // Post-filter for pending suggestions (computed field)
  const filteredData = params.hasPendingSuggestion
    ? data.filter((d) => d.hasPendingSuggestion)
    : data;

  return {
    data: filteredData,
    total: params.hasPendingSuggestion ? filteredData.length : total,
    page,
    pageSize,
    totalPages: Math.ceil((params.hasPendingSuggestion ? filteredData.length : total) / pageSize),
  };
}

export async function listTickets(
  params: ListTicketsParams
): Promise<PaginatedResult<TicketRow>> {
  const session = await requireCompanyAccess(params.companyId);
  return _listTicketsInternal(params, session);
}

/** Get counts for tab badges */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _getTicketTabCountsInternal(companyId: string, _session: JwtPayload): Promise<{
  slaCritical: number;
  refunds: number;
}> {
  const kpis = await getCompanyKpis(companyId);
  return {
    slaCritical: kpis.slaBreachedCount + kpis.slaAtRiskCount,
    refunds: kpis.pendingRefundsCount,
  };
}

export async function getTicketTabCounts(companyId: string): Promise<{
  slaCritical: number;
  refunds: number;
}> {
  const session = await requireCompanyAccess(companyId);
  return _getTicketTabCountsInternal(companyId, session);
}

/** Get SLA alert counts for sidebar badge and banner */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _getSlaAlertCountsInternal(companyId: string, _session: JwtPayload): Promise<{
  breached: number;
  atRisk: number;
}> {
  const kpis = await getCompanyKpis(companyId);
  return { breached: kpis.slaBreachedCount, atRisk: kpis.slaAtRiskCount };
}

export async function getSlaAlertCounts(companyId: string): Promise<{
  breached: number;
  atRisk: number;
}> {
  const session = await requireCompanyAccess(companyId);
  return _getSlaAlertCountsInternal(companyId, session);
}

export async function createTicket(input: CreateTicketInput) {
  const session = await requireCompanyAccess(input.companyId);

  if (!input.clientId?.trim()) {
    throw new Error("Cliente é obrigatório");
  }
  if (!input.subject?.trim()) {
    throw new Error("Assunto é obrigatório");
  }
  if (!input.description?.trim()) {
    throw new Error("Descrição é obrigatória");
  }

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, companyId: input.companyId },
  });
  if (!client) {
    throw new Error("Cliente não encontrado nesta empresa");
  }

  if (input.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assigneeId, status: "ACTIVE" },
    });
    if (!assignee) {
      throw new Error("Usuário responsável não encontrado");
    }
  }

  const ticket = await prisma.ticket.create({
    data: {
      clientId: input.clientId,
      subject: input.subject.trim(),
      description: input.description.trim(),
      priority: input.priority,
      assigneeId: input.assigneeId || null,
      proposalId: input.proposalId || null,
      boletoId: input.boletoId || null,
      companyId: input.companyId,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Ticket",
    entityId: ticket.id,
    dataAfter: {
      clientId: ticket.clientId,
      subject: ticket.subject,
      priority: ticket.priority,
      assigneeId: ticket.assigneeId,
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  invalidateKpiCache(input.companyId);
  sseBus.publish(`company:${input.companyId}:sac`, "sla-update", { timestamp: Date.now() });

  return { id: ticket.id };
}

export async function listClientsForSelect(companyId: string) {
  await requireCompanyAccess(companyId);

  const sharedIds = await getSharedCompanyIds(companyId);
  return prisma.client.findMany({
    where: { companyId: { in: sharedIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _listUsersForAssignInternal(companyId: string, _session: JwtPayload) {
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { role: "ADMIN" },
        {
          userCompanies: {
            some: { companyId },
          },
        },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return users;
}

export async function listUsersForAssign(companyId: string) {
  const session = await requireCompanyAccess(companyId);
  return _listUsersForAssignInternal(companyId, session);
}

// ---------------------------------------------------------------------------
// Ticket Detail
// ---------------------------------------------------------------------------

export interface TicketDetail {
  id: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  proposalId: string | null;
  boletoId: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  slaFirstReply: string | null;
  slaResolution: string | null;
  slaBreached: boolean;
  client: { id: string; name: string; email: string | null; cpfCnpj: string };
  assignee: { id: string; name: string } | null;
  company: { id: string; nomeFantasia: string };
  contact: { id: string; name: string; role: string | null } | null;
  channelType: ChannelType | null;
  aiEnabled: boolean;
  raExternalId: string | null;
  raStatusName: string | null;
  raRating: string | null;
  raCanEvaluate: boolean;
}

async function _getTicketByIdInternal(
  ticketId: string,
  companyId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _session: JwtPayload
): Promise<TicketDetail> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    include: {
      client: { select: { id: true, name: true, email: true, cpfCnpj: true } },
      assignee: { select: { id: true, name: true } },
      company: { select: { id: true, nomeFantasia: true } },
      contact: { select: { id: true, name: true, role: true } },
      channel: { select: { type: true } },
    },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  return {
    id: ticket.id,
    subject: ticket.subject,
    description: ticket.description,
    priority: ticket.priority,
    status: ticket.status,
    proposalId: ticket.proposalId,
    boletoId: ticket.boletoId,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    tags: ticket.tags,
    slaFirstReply: ticket.slaFirstReply?.toISOString() ?? null,
    slaResolution: ticket.slaResolution?.toISOString() ?? null,
    slaBreached: ticket.slaBreached,
    client: ticket.client,
    assignee: ticket.assignee,
    company: ticket.company,
    contact: ticket.contact,
    channelType: ticket.channel?.type ?? null,
    aiEnabled: ticket.aiEnabled,
    raExternalId: ticket.raExternalId ?? null,
    raStatusName: ticket.raStatusName ?? null,
    raRating: ticket.raRating ?? null,
    raCanEvaluate: ticket.raCanEvaluate ?? false,
  };
}

export async function getTicketById(
  ticketId: string,
  companyId: string
): Promise<TicketDetail> {
  const session = await requireCompanyAccess(companyId);
  return _getTicketByIdInternal(ticketId, companyId, session);
}

const VALID_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["WAITING_CLIENT", "RESOLVED"],
  WAITING_CLIENT: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

export async function updateTicketStatus(
  ticketId: string,
  companyId: string,
  newStatus: TicketStatus
) {
  const session = await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const allowed = VALID_STATUS_TRANSITIONS[ticket.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Transição de status inválida: ${ticket.status} → ${newStatus}`
    );
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: newStatus },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "Ticket",
    entityId: ticketId,
    dataBefore: { status: ticket.status } as unknown as Prisma.InputJsonValue,
    dataAfter: { status: newStatus } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  invalidateKpiCache(companyId);
  sseBus.publish(`company:${companyId}:sac`, "sla-update", { timestamp: Date.now() });
  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId, timestamp: Date.now() });

  return { status: updated.status };
}

export async function toggleTicketAi(
  ticketId: string,
  companyId: string,
  enabled: boolean
) {
  const session = await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { aiEnabled: enabled },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Ticket",
    entityId: ticketId,
    dataBefore: { aiEnabled: ticket.aiEnabled } as unknown as Prisma.InputJsonValue,
    dataAfter: { aiEnabled: enabled } as unknown as Prisma.InputJsonValue,
    companyId,
  });
}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _getAiConfigEnabledInternal(companyId: string, _session: JwtPayload): Promise<boolean> {
  const config = await prisma.aiConfig.findFirst({
    where: { companyId, channel: null },
    select: { enabled: true },
  });

  return config?.enabled ?? false;
}

export async function getAiConfigEnabled(companyId: string): Promise<boolean> {
  const session = await requireCompanyAccess(companyId);
  return _getAiConfigEnabledInternal(companyId, session);
}

export async function reassignTicket(
  ticketId: string,
  companyId: string,
  assigneeId: string | null
) {
  const session = await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  if (assigneeId) {
    const user = await prisma.user.findFirst({
      where: { id: assigneeId, status: "ACTIVE" },
    });
    if (!user) {
      throw new Error("Usuário responsável não encontrado");
    }
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { assigneeId: assigneeId || null },
    include: {
      assignee: { select: { id: true, name: true } },
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Ticket",
    entityId: ticketId,
    dataBefore: {
      assigneeId: ticket.assigneeId,
    } as unknown as Prisma.InputJsonValue,
    dataAfter: {
      assigneeId: updated.assigneeId,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { assignee: updated.assignee };
}

// ---------------------------------------------------------------------------
// Ticket Messages
// ---------------------------------------------------------------------------

export interface TicketMessageRow {
  id: string;
  content: string;
  sentViaEmail: boolean;
  createdAt: string;
  sender: {
    id: string;
    name: string;
  } | null;
}

export async function listTicketMessages(
  ticketId: string,
  companyId: string
): Promise<TicketMessageRow[]> {
  await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
    include: {
      sender: { select: { id: true, name: true } },
    },
  });

  return messages.map((m) => ({
    id: m.id,
    content: m.content,
    sentViaEmail: m.sentViaEmail,
    createdAt: m.createdAt.toISOString(),
    sender: m.sender,
  }));
}

export interface CreateTicketReplyInput {
  ticketId: string;
  companyId: string;
  content: string;
  sendViaEmail: boolean;
}

export async function createTicketReply(input: CreateTicketReplyInput) {
  const session = await requireCompanyAccess(input.companyId);

  if (!input.content?.trim()) {
    throw new Error("Conteúdo da resposta é obrigatório");
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: input.ticketId, companyId: input.companyId },
    include: {
      client: { select: { name: true, email: true } },
      company: { select: { nomeFantasia: true } },
    },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderId: session.userId,
      content: input.content.trim(),
      sentViaEmail: input.sendViaEmail,
    },
    include: {
      sender: { select: { id: true, name: true } },
    },
  });

  // Send email if requested and client has an email address
  if (input.sendViaEmail && ticket.client.email) {
    try {
      await sendEmail({
        to: ticket.client.email,
        subject: `Re: ${ticket.subject} - ${ticket.company.nomeFantasia}`,
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h3>Resposta ao ticket: ${ticket.subject}</h3>
            <p>${input.content.trim().replace(/\n/g, "<br>")}</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
            <p style="color: #6b7280; font-size: 12px;">
              ${ticket.company.nomeFantasia} - SAC
            </p>
          </div>
        `,
      });
    } catch {
      // Email failure should not block the reply creation
      logger.error("Failed to send ticket reply email");
    }
  }

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "TicketMessage",
    entityId: message.id,
    dataAfter: {
      ticketId: input.ticketId,
      sentViaEmail: input.sendViaEmail,
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  sseBus.publish(`company:${input.companyId}:sac`, "timeline-update", { ticketId: input.ticketId, timestamp: Date.now() });

  return {
    id: message.id,
    content: message.content,
    sentViaEmail: message.sentViaEmail,
    createdAt: message.createdAt.toISOString(),
    sender: message.sender,
  } as TicketMessageRow;
}

// ---------------------------------------------------------------------------
// Timeline Events
// ---------------------------------------------------------------------------

export type TimelineEventType = "message" | "internal_note" | "refund" | "status_change";

export interface TimelineAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  createdAt: string;
  content: string;
  channel: ChannelType | null;
  direction: MessageDirection | null;
  origin: MessageOrigin | null;
  isInternal: boolean;
  sentViaEmail: boolean;
  isAiGenerated: boolean;
  sender: { id: string; name: string } | null;
  contactName: string | null;
  contactRole: string | null;
  attachments: TimelineAttachment[];
  refundAmount: string | null;
  refundStatus: RefundStatus | null;
  oldStatus: string | null;
  deliveryStatus: string | null;
  newStatus: string | null;
}

export async function listTimelineEvents(
  ticketId: string,
  companyId: string,
  since?: string, // ISO timestamp — only return events after this time
  limit?: number // Cap total events returned (e.g. 50 for initial load)
): Promise<TimelineEvent[]> {
  await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  // When limit is set, over-fetch per source then truncate merged result
  const perSourceLimit = limit ? limit + 10 : undefined;

  const [messages, refunds, statusChanges] = await Promise.all([
    prisma.ticketMessage.findMany({
      where: { ticketId, ...(since ? { createdAt: { gt: new Date(since) } } : {}) },
      orderBy: { createdAt: "desc" },
      ...(perSourceLimit ? { take: perSourceLimit } : {}),
      include: {
        sender: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, role: true } },
        attachments: {
          select: {
            id: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            storagePath: true,
          },
        },
      },
    }),
    prisma.refund.findMany({
      where: { ticketId, ...(since ? { requestedAt: { gt: new Date(since) } } : {}) },
      ...(perSourceLimit ? { take: perSourceLimit } : {}),
      include: {
        requestedBy: { select: { name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        entityId: ticketId,
        entity: "Ticket",
        action: "STATUS_CHANGE",
        ...(since ? { createdAt: { gt: new Date(since) } } : {}),
      },
      include: {
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      ...(perSourceLimit ? { take: perSourceLimit } : {}),
    }),
  ]);

  const events: TimelineEvent[] = [];

  for (const m of messages) {
    events.push({
      id: m.id,
      type: m.isInternal ? "internal_note" : "message",
      createdAt: m.createdAt.toISOString(),
      content: m.content,
      channel: m.channel,
      direction: m.direction,
      origin: m.origin,
      isInternal: m.isInternal,
      sentViaEmail: m.sentViaEmail,
      isAiGenerated: m.isAiGenerated,
      deliveryStatus: m.deliveryStatus ?? null,
      sender: m.sender,
      contactName: m.contact?.name ?? null,
      contactRole: m.contact?.role ?? null,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        url: `/api/files/${a.storagePath}`,
      })),
      refundAmount: null,
      refundStatus: null,
      oldStatus: null,
      newStatus: null,
    });
  }

  for (const r of refunds) {
    events.push({
      id: `refund-${r.id}`,
      type: "refund",
      createdAt: r.requestedAt.toISOString(),
      content: `Reembolso de R$ ${Number(r.amount).toFixed(2)} solicitado por ${r.requestedBy.name}`,
      channel: null,
      direction: null,
      origin: null,
      isInternal: false,
      sentViaEmail: false,
      isAiGenerated: false,
      deliveryStatus: null,
      sender: null,
      contactName: null,
      contactRole: null,
      attachments: [],
      refundAmount: Number(r.amount).toFixed(2),
      refundStatus: r.status,
      oldStatus: null,
      newStatus: null,
    });
  }

  for (const sc of statusChanges) {
    const before = sc.dataBefore as Record<string, unknown> | null;
    const after = sc.dataAfter as Record<string, unknown> | null;
    const oldS = (before?.status as string) ?? null;
    const newS = (after?.status as string) ?? null;

    events.push({
      id: `status-${sc.id}`,
      type: "status_change",
      createdAt: sc.createdAt.toISOString(),
      content: `Status alterado para ${newS ?? "desconhecido"} por ${sc.user.name}`,
      channel: null,
      direction: null,
      origin: null,
      isInternal: false,
      sentViaEmail: false,
      isAiGenerated: false,
      sender: null,
      deliveryStatus: null,
      contactName: null,
      contactRole: null,
      attachments: [],
      refundAmount: null,
      refundStatus: null,
      oldStatus: oldS,
      newStatus: newS,
    });
  }

  events.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // When limit is set, return only the N most recent events
  return limit ? events.slice(-limit) : events;
}

// ---------------------------------------------------------------------------
// Internal Notes
// ---------------------------------------------------------------------------

export async function createInternalNote(
  ticketId: string,
  companyId: string,
  content: string,
  attachmentIds?: string[]
) {
  const session = await requireCompanyAccess(companyId);

  if (!content?.trim()) {
    throw new Error("Conteúdo é obrigatório");
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId,
      senderId: session.userId,
      content: content.trim(),
      isInternal: true,
      direction: "OUTBOUND",
      origin: "SYSTEM",
    },
    include: {
      sender: { select: { id: true, name: true } },
    },
  });

  if (attachmentIds?.length) {
    await prisma.attachment.updateMany({
      where: { id: { in: attachmentIds } },
      data: { ticketMessageId: message.id },
    });
  }

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "TicketMessage",
    entityId: message.id,
    dataAfter: {
      ticketId,
      isInternal: true,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId, timestamp: Date.now() });

  return { id: message.id, createdAt: message.createdAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Ticket Attachments
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Email Recipients
// ---------------------------------------------------------------------------

export interface EmailRecipient {
  email: string;
  name: string;
  role: string | null;
}

export async function getEmailRecipients(
  ticketId: string,
  companyId: string
): Promise<EmailRecipient[]> {
  await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          email: true,
          additionalContacts: {
            select: { name: true, email: true, role: true },
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const recipients: EmailRecipient[] = [];

  if (ticket.client.email) {
    recipients.push({
      email: ticket.client.email,
      name: ticket.client.name,
      role: "Cliente",
    });
  }

  for (const c of ticket.client.additionalContacts) {
    if (c.email) {
      recipients.push({
        email: c.email,
        name: c.name,
        role: c.role,
      });
    }
  }

  return recipients;
}

// ---------------------------------------------------------------------------
// Send Email Reply
// ---------------------------------------------------------------------------

export type AttachmentData = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
};

export async function sendEmailReply(
  ticketId: string,
  companyId: string,
  to: string,
  subject: string,
  content: string,
  attachments?: AttachmentData[]
) {
  const session = await requireCompanyAccess(companyId);

  if (!content?.trim()) {
    throw new Error("Conteúdo é obrigatório");
  }
  if (!to?.trim()) {
    throw new Error("Destinatário é obrigatório");
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  // Create message + attachments in a single transaction
  const { message, attachmentIds } = await prisma.$transaction(async (tx) => {
    const msg = await tx.ticketMessage.create({
      data: {
        ticketId,
        senderId: session.userId,
        content: content.trim(),
        channel: "EMAIL",
        direction: "OUTBOUND",
        origin: "SYSTEM",
        sentViaEmail: true,
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    const attIds: string[] = [];
    if (attachments?.length) {
      for (const a of attachments) {
        const att = await tx.attachment.create({
          data: {
            ticketId,
            ticketMessageId: msg.id,
            fileName: a.fileName,
            fileSize: a.fileSize,
            mimeType: a.mimeType,
            storagePath: a.storagePath,
          },
        });
        attIds.push(att.id);
      }
    }

    return { message: msg, attachmentIds: attIds };
  });

  // Enqueue SMTP send job
  try {
    const { emailOutboundQueue } = await import("@/lib/queue");
    await emailOutboundQueue.add("send-email", {
      messageId: message.id,
      ticketId,
      companyId,
      to,
      subject,
      content: content.trim(),
      attachmentIds,
    });
  } catch (err) {
    logger.error({ err: err }, "Failed to enqueue email-outbound job:");
  }

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "TicketMessage",
    entityId: message.id,
    dataAfter: {
      ticketId,
      channel: "EMAIL",
      direction: "OUTBOUND",
      to,
      subject,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId, timestamp: Date.now() });

  return { id: message.id, createdAt: message.createdAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Ticket Attachments
// ---------------------------------------------------------------------------

export async function attachFileToTicket(
  ticketId: string,
  companyId: string,
  attachmentData: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    storagePath: string;
  }
) {
  const session = await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const attachment = await prisma.attachment.create({
    data: {
      ticketId,
      fileName: attachmentData.fileName,
      fileSize: attachmentData.fileSize,
      mimeType: attachmentData.mimeType,
      storagePath: attachmentData.storagePath,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Attachment",
    entityId: attachment.id,
    dataAfter: {
      ticketId,
      fileName: attachmentData.fileName,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return {
    id: attachment.id,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    url: `/api/files/${attachment.storagePath}`,
  };
}

// ---------------------------------------------------------------------------
// WhatsApp Recipients
// ---------------------------------------------------------------------------

export interface WhatsAppRecipient {
  phone: string;
  name: string;
  role: string | null;
}

export async function getWhatsAppRecipients(
  ticketId: string,
  companyId: string
): Promise<WhatsAppRecipient[]> {
  await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          telefone: true,
          additionalContacts: {
            select: { name: true, whatsapp: true, role: true },
            orderBy: { name: "asc" },
          },
        },
      },
    },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const recipients: WhatsAppRecipient[] = [];
  const seenPhones = new Set<string>();

  if (ticket.client.telefone) {
    const digits = ticket.client.telefone.replace(/\D/g, "");
    seenPhones.add(digits);
    recipients.push({
      phone: ticket.client.telefone,
      name: ticket.client.name,
      role: "Cliente",
    });
  }

  for (const c of ticket.client.additionalContacts) {
    if (c.whatsapp) {
      const digits = c.whatsapp.replace(/\D/g, "");
      if (!seenPhones.has(digits)) {
        seenPhones.add(digits);
        recipients.push({
          phone: c.whatsapp,
          name: c.name,
          role: c.role,
        });
      }
    }
  }

  // If no recipients from contacts, extract phone from inbound WhatsApp messages
  if (recipients.length === 0) {
    const inboundMsg = await prisma.ticketMessage.findFirst({
      where: {
        ticketId,
        channel: "WHATSAPP",
        direction: "INBOUND",
        externalId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { externalId: true },
    });

    if (inboundMsg?.externalId && ticket.description) {
      // Try to extract the WhatsApp JID (most reliable for replying)
      const jidMatch = ticket.description.match(/WhatsApp JID:\s*(\S+)/);
      const phoneMatch = ticket.description.match(/Número:\s*(\d+)/);

      if (jidMatch) {
        // Use the full JID — the WhatsApp Service can send to LIDs directly
        const jid = jidMatch[1];
        const digits = jid.replace(/@.*$/, "").replace(/\D/g, "");
        recipients.push({
          phone: digits,
          name: ticket.description.match(/de\s+(.+?)\.\s*Número/)?.[1] || "Remetente WhatsApp",
          role: null,
        });
      } else if (phoneMatch) {
        recipients.push({
          phone: phoneMatch[1],
          name: "Remetente WhatsApp",
          role: null,
        });
      }
    }
  }

  // Last resort: extract phone from ticket description
  if (recipients.length === 0 && ticket.description) {
    const phoneMatch = ticket.description.match(/\b(\d{10,15})\b/);
    if (phoneMatch) {
      recipients.push({
        phone: phoneMatch[1],
        name: "Remetente WhatsApp",
        role: null,
      });
    }
  }

  return recipients;
}

// ---------------------------------------------------------------------------
// Send WhatsApp Message
// ---------------------------------------------------------------------------

export async function sendWhatsAppMessage(
  ticketId: string,
  companyId: string,
  to: string,
  content: string,
  attachments?: AttachmentData[]
) {
  const session = await requireCompanyAccess(companyId);

  if (!content?.trim()) {
    throw new Error("Conteúdo é obrigatório");
  }
  if (!to?.trim()) {
    throw new Error("Destinatário é obrigatório");
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  // Create message + attachments in a single transaction
  const { message, attachmentIds } = await prisma.$transaction(async (tx) => {
    const msg = await tx.ticketMessage.create({
      data: {
        ticketId,
        senderId: session.userId,
        content: content.trim(),
        channel: "WHATSAPP",
        direction: "OUTBOUND",
        origin: "SYSTEM",
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    const attIds: string[] = [];
    if (attachments?.length) {
      for (const a of attachments) {
        const att = await tx.attachment.create({
          data: {
            ticketId,
            ticketMessageId: msg.id,
            fileName: a.fileName,
            fileSize: a.fileSize,
            mimeType: a.mimeType,
            storagePath: a.storagePath,
          },
        });
        attIds.push(att.id);
      }
    }

    return { message: msg, attachmentIds: attIds };
  });

  // Enqueue WhatsApp send job
  try {
    const { whatsappOutboundQueue } = await import("@/lib/queue");
    await whatsappOutboundQueue.add("send-whatsapp", {
      messageId: message.id,
      ticketId,
      companyId,
      to,
      content: content.trim(),
      attachmentIds,
    });
  } catch (err) {
    logger.error({ err: err }, "Failed to enqueue whatsapp-outbound job:");
  }

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "TicketMessage",
    entityId: message.id,
    dataAfter: {
      ticketId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      to,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId, timestamp: Date.now() });

  return { id: message.id, createdAt: message.createdAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Client Financial Summary
// ---------------------------------------------------------------------------

export interface ClientFinancialSummary {
  status: "adimplente" | "atraso" | "inadimplente";
  pendingTotal: number;
  overdueTotal: number;
  lastPayment: string | null;
}

async function _getClientFinancialSummaryInternal(
  clientId: string,
  companyId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _session: JwtPayload
): Promise<ClientFinancialSummary> {
  const [pending, overdue, lastPaid] = await Promise.all([
    prisma.accountReceivable.aggregate({
      where: { clientId, companyId, status: "PENDING" },
      _sum: { value: true },
    }),
    prisma.accountReceivable.aggregate({
      where: { clientId, companyId, status: "OVERDUE" },
      _sum: { value: true },
    }),
    prisma.accountReceivable.findFirst({
      where: { clientId, companyId, status: "PAID" },
      orderBy: { paidAt: "desc" },
      select: { paidAt: true },
    }),
  ]);

  const pendingTotal = Number(pending._sum.value ?? 0);
  const overdueTotal = Number(overdue._sum.value ?? 0);

  let status: ClientFinancialSummary["status"] = "adimplente";
  if (overdueTotal > 0) {
    // More than 30 days overdue = inadimplente
    const oldOverdue = await prisma.accountReceivable.findFirst({
      where: {
        clientId,
        companyId,
        status: "OVERDUE",
        dueDate: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    status = oldOverdue ? "inadimplente" : "atraso";
  }

  return {
    status,
    pendingTotal,
    overdueTotal,
    lastPayment: lastPaid?.paidAt?.toISOString() ?? null,
  };
}

export async function getClientFinancialSummary(
  clientId: string,
  companyId: string
): Promise<ClientFinancialSummary> {
  const session = await requireCompanyAccess(companyId);
  return _getClientFinancialSummaryInternal(clientId, companyId, session);
}

// ---------------------------------------------------------------------------
// Contact Linking (US-081)
// ---------------------------------------------------------------------------

export interface ClientForLink {
  id: string;
  name: string;
  cpfCnpj: string;
  email: string | null;
  telefone: string | null;
}

/** Search clients for linking (excludes unknown placeholder) */
export async function searchClientsForLink(
  companyId: string,
  search: string
): Promise<ClientForLink[]> {
  await requireCompanyAccess(companyId);

  if (!search?.trim() || search.trim().length < 2) {
    return [];
  }

  const sharedIds = await getSharedCompanyIds(companyId);

  return prisma.client.findMany({
    where: {
      companyId: { in: sharedIds },
      cpfCnpj: { not: "00000000000" },
      OR: [
        { name: { contains: search.trim(), mode: "insensitive" } },
        { cpfCnpj: { contains: search.trim(), mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      cpfCnpj: true,
      email: true,
      telefone: true,
    },
    orderBy: { name: "asc" },
    take: 10,
  });
}

/** Extract sender info from ticket description for unknown contacts */
function extractSenderInfo(description: string): {
  email: string | null;
  phone: string | null;
} {
  // WhatsApp: "Mensagem recebida via WhatsApp de {name}. Número: {phone}"
  const phoneMatch = description.match(/Número:\s*(\+?[\d]+)/);
  // Email: "Email recebido de {email}. Remetente não identificado."
  const emailMatch = description.match(/Email recebido de\s+([\w.+-]+@[\w.-]+)/);

  return {
    email: emailMatch?.[1] ?? null,
    phone: phoneMatch?.[1] ?? null,
  };
}

/** Link ticket to existing client, optionally creating an AdditionalContact */
export async function linkContactToClient(
  ticketId: string,
  companyId: string,
  clientId: string
) {
  const session = await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true, tags: true, clientId: true, description: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  // Verify the current client is the unknown placeholder
  const currentClient = await prisma.client.findFirst({
    where: { id: ticket.clientId },
    select: { cpfCnpj: true },
  });
  if (currentClient?.cpfCnpj !== "00000000000") {
    throw new Error("Este ticket já está vinculado a um cliente identificado");
  }

  // Validate target client
  const targetClient = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: { id: true, name: true },
  });
  if (!targetClient) {
    throw new Error("Cliente não encontrado nesta empresa");
  }

  // Extract sender info and create AdditionalContact if applicable
  const senderInfo = extractSenderInfo(ticket.description);
  if (senderInfo.email || senderInfo.phone) {
    await prisma.additionalContact.create({
      data: {
        clientId,
        name: "Contato via " + (senderInfo.email ? "Email" : "WhatsApp"),
        email: senderInfo.email,
        whatsapp: senderInfo.phone,
      },
    });
  }

  // Update ticket: change client and remove "Pendente Vinculação" tag
  const newTags = ticket.tags.filter((t) => t !== "Pendente Vinculação");
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { clientId, tags: newTags },
  });

  // Also update any other tickets from the same unknown client to this new client
  // if they have the same sender info (batch linking)
  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Ticket",
    entityId: ticketId,
    dataAfter: {
      action: "LINK_CONTACT",
      clientId,
      clientName: targetClient.name,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { clientId, clientName: targetClient.name };
}

/** Create a new client and link to ticket */
export async function createClientAndLink(
  ticketId: string,
  companyId: string,
  clientData: {
    name: string;
    cpfCnpj: string;
    type: "PF" | "PJ";
    email?: string;
    telefone?: string;
    razaoSocial?: string;
    endereco?: string;
  }
) {
  const session = await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true, tags: true, clientId: true, description: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  // Verify the current client is the unknown placeholder
  const currentClient = await prisma.client.findFirst({
    where: { id: ticket.clientId },
    select: { cpfCnpj: true },
  });
  if (currentClient?.cpfCnpj !== "00000000000") {
    throw new Error("Este ticket já está vinculado a um cliente identificado");
  }

  if (!clientData.name?.trim()) {
    throw new Error("Nome é obrigatório");
  }
  if (!clientData.cpfCnpj?.trim()) {
    throw new Error("CPF/CNPJ é obrigatório");
  }

  // Check uniqueness
  const existing = await prisma.client.findFirst({
    where: { cpfCnpj: clientData.cpfCnpj.trim(), companyId },
  });
  if (existing) {
    throw new Error(
      `Já existe um cliente com este ${clientData.type === "PF" ? "CPF" : "CNPJ"} nesta empresa`
    );
  }

  // Create client
  const newClient = await prisma.client.create({
    data: {
      name: clientData.name.trim(),
      razaoSocial: clientData.razaoSocial?.trim() || null,
      cpfCnpj: clientData.cpfCnpj.trim(),
      email: clientData.email?.trim() || null,
      telefone: clientData.telefone?.trim() || null,
      endereco: clientData.endereco?.trim() || null,
      type: clientData.type,
      companyId,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Client",
    entityId: newClient.id,
    dataAfter: newClient as unknown as Prisma.InputJsonValue,
    companyId,
  });

  // Update ticket: change client and remove "Pendente Vinculação" tag
  const newTags = ticket.tags.filter((t) => t !== "Pendente Vinculação");
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { clientId: newClient.id, tags: newTags },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Ticket",
    entityId: ticketId,
    dataAfter: {
      action: "LINK_CONTACT",
      clientId: newClient.id,
      clientName: newClient.name,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { clientId: newClient.id, clientName: newClient.name };
}

// ---------------------------------------------------------------------------
// Refund Data for Sidebar (US-085)
// ---------------------------------------------------------------------------

export interface RefundSummary {
  id: string;
  amount: number;
  status: RefundStatus;
  requestedAt: string;
  approvedAt: string | null;
  executedAt: string | null;
  completedAt: string | null;
  slaDeadline: string | null;
  slaBreached: boolean;
  rejectionReason: string | null;
  paymentMethod: string | null;
  requestedBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
}

async function _getTicketRefundsInternal(
  ticketId: string,
  companyId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _session: JwtPayload
): Promise<RefundSummary[]> {
  const refunds = await prisma.refund.findMany({
    where: { ticketId, companyId },
    include: {
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: { requestedAt: "desc" },
  });

  return refunds.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    approvedAt: r.approvedAt?.toISOString() ?? null,
    executedAt: r.executedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    slaDeadline: r.slaDeadline?.toISOString() ?? null,
    slaBreached: r.slaBreached,
    rejectionReason: r.rejectionReason,
    paymentMethod: r.paymentMethod,
    requestedBy: r.requestedBy,
    approvedBy: r.approvedBy,
  }));
}

export async function getTicketRefunds(
  ticketId: string,
  companyId: string
): Promise<RefundSummary[]> {
  const session = await requireCompanyAccess(companyId);
  return _getTicketRefundsInternal(ticketId, companyId, session);
}

async function _getUserRoleInternal(companyId: string, session: JwtPayload): Promise<string> {
  void companyId; // companyId was already validated by caller
  return session.role;
}

export async function getUserRole(companyId: string): Promise<string> {
  const session = await requireCompanyAccess(companyId);
  return _getUserRoleInternal(companyId, session);
}

// ---------------------------------------------------------------------------
// Refund Request (US-082)
// ---------------------------------------------------------------------------

export async function requestRefund(
  ticketId: string,
  companyId: string,
  amount: number,
  justification: string,
  paymentProofId: string,
  boletoId?: string
) {
  const session = await requireCompanyAccess(companyId);

  if (!amount || amount <= 0) {
    throw new Error("Valor do reembolso deve ser maior que zero");
  }
  if (!justification?.trim()) {
    throw new Error("Justificativa é obrigatória");
  }
  if (!paymentProofId) {
    throw new Error("Comprovante de pagamento é obrigatório");
  }

  // Validate ticket exists and belongs to company
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true, tags: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  // Validate payment proof attachment exists
  const proofAttachment = await prisma.attachment.findUnique({
    where: { id: paymentProofId },
    select: { fileName: true, fileSize: true, mimeType: true, storagePath: true },
  });
  if (!proofAttachment) {
    throw new Error("Comprovante de pagamento não encontrado");
  }

  // Validate boleto if provided
  if (boletoId) {
    const boleto = await prisma.boleto.findFirst({
      where: { id: boletoId, companyId },
      select: { id: true },
    });
    if (!boleto) {
      throw new Error("Boleto não encontrado");
    }
  }

  // Get SLA config for REFUND approval stage
  let slaDeadline: Date | null = null;
  const slaConfig = await prisma.slaConfig.findFirst({
    where: { companyId, type: "REFUND", stage: "approval" },
    select: { deadlineMinutes: true },
  });

  if (slaConfig) {
    // Optionally get business hours for SLA calculation
    const bhConfig = await prisma.slaConfig.findFirst({
      where: { companyId, type: "TICKET", priority: null, stage: "business_hours" },
      select: { deadlineMinutes: true, alertBeforeMinutes: true },
    });

    let businessHours: import("@/lib/sla").BusinessHours | undefined;
    if (bhConfig) {
      const startHour = Math.floor(bhConfig.deadlineMinutes / 100);
      const endHour = bhConfig.deadlineMinutes % 100;
      const workDaysBitmask = bhConfig.alertBeforeMinutes;
      const workDays: number[] = [];
      for (let d = 0; d < 7; d++) {
        if (workDaysBitmask & (1 << d)) workDays.push(d);
      }
      businessHours = { enabled: true, startHour, endHour, workDays };
    }

    const { calculateSlaDeadline } = await import("@/lib/sla");
    slaDeadline = calculateSlaDeadline(new Date(), slaConfig.deadlineMinutes, businessHours);
  } else {
    // Default: 4 hours (240 minutes) for approval
    const { calculateSlaDeadline } = await import("@/lib/sla");
    slaDeadline = calculateSlaDeadline(new Date(), 240);
  }

  // Create refund with payment proof in a transaction
  const refund = await prisma.$transaction(async (tx) => {
    const newRefund = await tx.refund.create({
      data: {
        ticketId,
        companyId,
        requestedById: session.userId,
        amount,
        justification: justification.trim(),
        boletoId: boletoId ?? null,
        status: "AWAITING_APPROVAL",
        slaDeadline,
      },
    });

    // Create RefundAttachment for payment proof
    await tx.refundAttachment.create({
      data: {
        refundId: newRefund.id,
        type: "PAYMENT_PROOF",
        fileName: proofAttachment.fileName,
        fileSize: proofAttachment.fileSize,
        mimeType: proofAttachment.mimeType,
        storagePath: proofAttachment.storagePath,
        uploadedById: session.userId,
      },
    });

    // Add "Reembolso" tag to ticket if not already present
    if (!ticket.tags.includes("Reembolso")) {
      await tx.ticket.update({
        where: { id: ticketId },
        data: { tags: { push: "Reembolso" } },
      });
    }

    // Register timeline event (internal note about refund request)
    await tx.ticketMessage.create({
      data: {
        ticketId,
        senderId: session.userId,
        content: `Solicitação de reembolso no valor de R$ ${amount.toFixed(2)}. Justificativa: ${justification.trim()}`,
        direction: "OUTBOUND",
        origin: "SYSTEM",
        isInternal: true,
      },
    });

    return newRefund;
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Refund",
    entityId: refund.id,
    dataAfter: {
      ticketId,
      amount,
      justification: justification.trim(),
      paymentProofId,
      boletoId: boletoId ?? null,
      slaDeadline: slaDeadline?.toISOString() ?? null,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  invalidateKpiCache(companyId);
  sseBus.publish(`company:${companyId}:sac`, "sla-update", { timestamp: Date.now() });
  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId, timestamp: Date.now() });

  return {
    id: refund.id,
    status: refund.status,
    amount: Number(refund.amount),
    slaDeadline: refund.slaDeadline?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Refund Approval / Rejection
// ---------------------------------------------------------------------------

export async function approveRefund(refundId: string, companyId: string) {
  const session = await requireCompanyAccess(companyId);

  // Only ADMIN and MANAGER can approve refunds
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    throw new Error("Acesso negado. Apenas administradores e gestores podem aprovar reembolsos.");
  }

  // Fetch refund and validate
  const refund = await prisma.refund.findFirst({
    where: { id: refundId, companyId },
    select: { id: true, ticketId: true, status: true, amount: true },
  });
  if (!refund) {
    throw new Error("Reembolso não encontrado");
  }
  if (refund.status !== "AWAITING_APPROVAL") {
    throw new Error("Este reembolso não está aguardando aprovação");
  }

  // Calculate new SLA deadline for execution stage
  let slaDeadline: Date | null = null;
  const slaConfig = await prisma.slaConfig.findFirst({
    where: { companyId, type: "REFUND", stage: "execution" },
    select: { deadlineMinutes: true },
  });

  // Get business hours config
  const bhConfig = await prisma.slaConfig.findFirst({
    where: { companyId, type: "TICKET", priority: null, stage: "business_hours" },
    select: { deadlineMinutes: true, alertBeforeMinutes: true },
  });

  let businessHours: import("@/lib/sla").BusinessHours | undefined;
  if (bhConfig) {
    const startHour = Math.floor(bhConfig.deadlineMinutes / 100);
    const endHour = bhConfig.deadlineMinutes % 100;
    const workDaysBitmask = bhConfig.alertBeforeMinutes;
    const workDays: number[] = [];
    for (let d = 0; d < 7; d++) {
      if (workDaysBitmask & (1 << d)) workDays.push(d);
    }
    businessHours = { enabled: true, startHour, endHour, workDays };
  }

  const { calculateSlaDeadline } = await import("@/lib/sla");
  if (slaConfig) {
    slaDeadline = calculateSlaDeadline(new Date(), slaConfig.deadlineMinutes, businessHours);
  } else {
    // Default: 24 hours (1440 minutes) for execution
    slaDeadline = calculateSlaDeadline(new Date(), 1440, businessHours);
  }

  // Update refund and create timeline event in transaction
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: "APPROVED",
        approvedById: session.userId,
        approvedAt: new Date(),
        slaDeadline,
        slaBreached: false,
      },
    });

    // Timeline event
    await tx.ticketMessage.create({
      data: {
        ticketId: refund.ticketId,
        senderId: session.userId,
        content: `Reembolso de R$ ${Number(refund.amount).toFixed(2)} aprovado.`,
        direction: "OUTBOUND",
        origin: "SYSTEM",
        isInternal: true,
      },
    });
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Refund",
    entityId: refundId,
    dataAfter: {
      status: "APPROVED",
      approvedById: session.userId,
      slaDeadline: slaDeadline?.toISOString() ?? null,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  invalidateKpiCache(companyId);
  sseBus.publish(`company:${companyId}:sac`, "sla-update", { timestamp: Date.now() });
  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId: refund.ticketId, timestamp: Date.now() });

  return { success: true };
}

export async function rejectRefund(
  refundId: string,
  companyId: string,
  reason: string
) {
  const session = await requireCompanyAccess(companyId);

  // Only ADMIN and MANAGER can reject refunds
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    throw new Error("Acesso negado. Apenas administradores e gestores podem rejeitar reembolsos.");
  }

  if (!reason?.trim()) {
    throw new Error("Motivo da rejeição é obrigatório");
  }

  // Fetch refund and validate
  const refund = await prisma.refund.findFirst({
    where: { id: refundId, companyId },
    select: { id: true, ticketId: true, status: true, amount: true },
  });
  if (!refund) {
    throw new Error("Reembolso não encontrado");
  }
  if (refund.status !== "AWAITING_APPROVAL") {
    throw new Error("Este reembolso não está aguardando aprovação");
  }

  // Update refund and create timeline event in transaction
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: "REJECTED",
        rejectionReason: reason.trim(),
        approvedById: session.userId,
        approvedAt: new Date(),
      },
    });

    // Timeline event
    await tx.ticketMessage.create({
      data: {
        ticketId: refund.ticketId,
        senderId: session.userId,
        content: `Reembolso de R$ ${Number(refund.amount).toFixed(2)} rejeitado. Motivo: ${reason.trim()}`,
        direction: "OUTBOUND",
        origin: "SYSTEM",
        isInternal: true,
      },
    });
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Refund",
    entityId: refundId,
    dataAfter: {
      status: "REJECTED",
      rejectionReason: reason.trim(),
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  invalidateKpiCache(companyId);
  sseBus.publish(`company:${companyId}:sac`, "sla-update", { timestamp: Date.now() });
  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId: refund.ticketId, timestamp: Date.now() });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Refund Execution
// ---------------------------------------------------------------------------

export async function executeRefund(
  refundId: string,
  companyId: string,
  data: {
    paymentMethod: "PIX" | "TED";
    bankName?: string;
    bankAgency?: string;
    bankAccount?: string;
    pixKey?: string;
    invoiceAction: "CANCEL_INVOICE" | "CREDIT_NOTE" | "NONE";
    invoiceCancelReason?: string;
    refundProofId?: string;
  }
) {
  const session = await requireCompanyAccess(companyId);

  // Only ADMIN and MANAGER can execute refunds
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    throw new Error(
      "Acesso negado. Apenas administradores e gestores podem executar reembolsos."
    );
  }

  // Validate payment method fields
  if (data.paymentMethod === "TED") {
    if (!data.bankName?.trim() || !data.bankAgency?.trim() || !data.bankAccount?.trim()) {
      throw new Error("Dados bancários (banco, agência e conta) são obrigatórios para TED");
    }
  } else if (data.paymentMethod === "PIX") {
    if (!data.pixKey?.trim()) {
      throw new Error("Chave PIX é obrigatória para pagamento via PIX");
    }
  }

  if (data.invoiceAction === "CANCEL_INVOICE" && !data.invoiceCancelReason?.trim()) {
    throw new Error("Motivo do cancelamento da NFS-e é obrigatório");
  }

  // Fetch refund with ticket and client info
  const refund = await prisma.refund.findFirst({
    where: { id: refundId, companyId },
    select: {
      id: true,
      ticketId: true,
      status: true,
      amount: true,
      ticket: {
        select: {
          id: true,
          clientId: true,
          subject: true,
          proposalId: true,
          boletoId: true,
          client: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!refund) {
    throw new Error("Reembolso não encontrado");
  }
  if (refund.status !== "APPROVED") {
    throw new Error("Este reembolso não está aprovado para execução");
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // 1. Update Refund to COMPLETED
    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: "COMPLETED",
        paymentMethod: data.paymentMethod,
        bankName: data.bankName?.trim() || null,
        bankAgency: data.bankAgency?.trim() || null,
        bankAccount: data.bankAccount?.trim() || null,
        pixKey: data.pixKey?.trim() || null,
        invoiceAction: data.invoiceAction,
        invoiceCancelReason: data.invoiceCancelReason?.trim() || null,
        executedById: session.userId,
        executedAt: now,
        completedAt: now,
      },
    });

    // 2. Create AccountPayable origin=REFUND, status=PAID
    await tx.accountPayable.create({
      data: {
        supplier: refund.ticket.client.name,
        description: `Reembolso ref Ticket #${refund.ticket.subject}`,
        value: refund.amount,
        dueDate: now,
        status: "PAID",
        paidAt: now,
        origin: "REFUND",
        refundId: refund.id,
        companyId,
      },
    });

    // 3. Handle invoice action
    if (data.invoiceAction === "CANCEL_INVOICE") {
      // Find invoices related to the ticket's proposal or boleto
      const whereClause: Prisma.InvoiceWhereInput = {
        companyId,
        status: { not: "CANCELLED" },
        type: "STANDARD",
        OR: [
          ...(refund.ticket.proposalId
            ? [{ proposalId: refund.ticket.proposalId }]
            : []),
          ...(refund.ticket.boletoId
            ? [{ boletoId: refund.ticket.boletoId }]
            : []),
        ],
      };

      // Only search if there's a proposal or boleto linked
      if (refund.ticket.proposalId || refund.ticket.boletoId) {
        await tx.invoice.updateMany({
          where: whereClause,
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancellationReason: data.invoiceCancelReason!.trim(),
          },
        });

        // Cancel TaxEntries linked to the cancelled invoices
        const cancelledInvoices = await tx.invoice.findMany({
          where: { ...whereClause, status: "CANCELLED" },
          select: { id: true },
        });
        if (cancelledInvoices.length > 0) {
          await tx.taxEntry.updateMany({
            where: {
              invoiceId: { in: cancelledInvoices.map((i) => i.id) },
              status: { not: "CANCELLED" },
            },
            data: { status: "CANCELLED" },
          });
        }
      }
    } else if (data.invoiceAction === "CREDIT_NOTE") {
      // Find original invoice to reference
      let originalInvoiceId: string | null = null;
      if (refund.ticket.proposalId || refund.ticket.boletoId) {
        const originalInvoice = await tx.invoice.findFirst({
          where: {
            companyId,
            type: "STANDARD",
            status: { not: "CANCELLED" },
            OR: [
              ...(refund.ticket.proposalId
                ? [{ proposalId: refund.ticket.proposalId }]
                : []),
              ...(refund.ticket.boletoId
                ? [{ boletoId: refund.ticket.boletoId }]
                : []),
            ],
          },
          select: { id: true },
          orderBy: { createdAt: "desc" },
        });
        originalInvoiceId = originalInvoice?.id ?? null;
      }

      const creditNote = await tx.invoice.create({
        data: {
          clientId: refund.ticket.clientId,
          serviceDescription: `Nota de crédito - Reembolso ref Ticket #${refund.ticket.subject}`,
          value: refund.amount,
          issRate: 0,
          status: "ISSUED",
          type: "CREDIT_NOTE",
          refundId: refund.id,
          originalInvoiceId,
          companyId,
        },
      });

      // Create estorno TaxEntries for the credit note (inside tx for rollback safety)
      const fiscalConfig = await getCachedFiscalConfig(companyId);
      await createTaxEntriesForInvoice({
        invoiceId: creditNote.id,
        companyId,
        value: Number(refund.amount),
        fiscalConfig,
        isEstorno: true,
        tx,
      });
    }

    // 4. Cancel pending AccountReceivable for the client if any
    await tx.accountReceivable.updateMany({
      where: {
        clientId: refund.ticket.clientId,
        companyId,
        status: "PENDING",
      },
      data: {
        status: "CANCELLED",
      },
    });

    // 5. Attach refund proof if provided
    if (data.refundProofId) {
      const proofFile = await tx.attachment.findUnique({
        where: { id: data.refundProofId },
        select: { fileName: true, fileSize: true, mimeType: true, storagePath: true },
      });
      if (proofFile) {
        await tx.refundAttachment.create({
          data: {
            refundId: refund.id,
            type: "REFUND_PROOF",
            fileName: proofFile.fileName,
            fileSize: proofFile.fileSize,
            mimeType: proofFile.mimeType,
            storagePath: proofFile.storagePath,
            uploadedById: session.userId,
          },
        });
      }
    }

    // 6. Timeline event
    const methodLabel = data.paymentMethod === "PIX" ? "PIX" : "TED";
    await tx.ticketMessage.create({
      data: {
        ticketId: refund.ticketId,
        senderId: session.userId,
        content: `Reembolso de R$ ${Number(refund.amount).toFixed(2)} executado via ${methodLabel}. Status: Concluído.`,
        direction: "OUTBOUND",
        origin: "SYSTEM",
        isInternal: true,
      },
    });
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Refund",
    entityId: refundId,
    dataAfter: {
      status: "COMPLETED",
      paymentMethod: data.paymentMethod,
      invoiceAction: data.invoiceAction,
      executedById: session.userId,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  invalidateKpiCache(companyId);
  sseBus.publish(`company:${companyId}:sac`, "sla-update", { timestamp: Date.now() });
  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId: refund.ticketId, timestamp: Date.now() });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Aggregated Bootstrap — single roundtrip for ticket list page
// ---------------------------------------------------------------------------

export interface TicketListBootstrap {
  tickets: PaginatedResult<TicketRow>;
  tabCounts: Awaited<ReturnType<typeof getTicketTabCounts>>;
  slaAlerts: Awaited<ReturnType<typeof getSlaAlertCounts>>;
}

export async function getTicketListBootstrap(
  params: ListTicketsParams
): Promise<TicketListBootstrap> {
  const session = await requireCompanyAccess(params.companyId);

  const [tickets, tabCounts, slaAlerts] = await Promise.all([
    _listTicketsInternal(params, session),
    _getTicketTabCountsInternal(params.companyId, session),
    _getSlaAlertCountsInternal(params.companyId, session),
  ]);

  return { tickets, tabCounts, slaAlerts };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function addTag(
  ticketId: string,
  companyId: string,
  tag: string
): Promise<string[]> {
  const session = await requireCompanyAccess(companyId);

  if (!tag?.trim()) {
    throw new Error("Tag é obrigatória");
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true, tags: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const normalizedTag = tag.trim();
  if (ticket.tags.includes(normalizedTag)) {
    return ticket.tags;
  }

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { tags: { push: normalizedTag } },
    select: { tags: true },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Ticket",
    entityId: ticketId,
    dataAfter: { tagAdded: normalizedTag } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return updated.tags;
}

export async function removeTag(
  ticketId: string,
  companyId: string,
  tag: string
): Promise<string[]> {
  const session = await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true, tags: true },
  });
  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const newTags = ticket.tags.filter((t) => t !== tag);

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { tags: newTags },
    select: { tags: true },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Ticket",
    entityId: ticketId,
    dataAfter: { tagRemoved: tag } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return updated.tags;
}

// ---------------------------------------------------------------------------
// Cancellation Request (US-086)
// ---------------------------------------------------------------------------

export type CancellationType = "proposal" | "boletos" | "both";

export interface CancellationInfo {
  pending: boolean;
  type: CancellationType | null;
  justification: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
}

async function _getCancellationInfoInternal(
  ticketId: string,
  companyId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _session: JwtPayload
): Promise<CancellationInfo> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { tags: true },
  });
  if (!ticket) throw new Error("Ticket não encontrado");

  if (!ticket.tags.includes("Cancelamento Pendente")) {
    return { pending: false, type: null, justification: null, requestedBy: null, requestedAt: null };
  }

  // Find the most recent cancellation request note
  const note = await prisma.ticketMessage.findFirst({
    where: {
      ticketId,
      isInternal: true,
      content: { startsWith: "[CANCELAMENTO]" },
    },
    orderBy: { createdAt: "desc" },
    include: { sender: { select: { name: true } } },
  });

  if (!note) {
    return { pending: true, type: null, justification: null, requestedBy: null, requestedAt: null };
  }

  // Parse type from note content: [CANCELAMENTO] Tipo: proposal | Justificativa: ...
  const typeMatch = note.content.match(/Tipo:\s*(proposal|boletos|both)/);
  const justMatch = note.content.match(/Justificativa:\s*([\s\S]+?)(?:\s*$)/);

  return {
    pending: true,
    type: (typeMatch?.[1] as CancellationType) ?? null,
    justification: justMatch?.[1]?.trim() ?? null,
    requestedBy: note.sender?.name ?? null,
    requestedAt: note.createdAt.toISOString(),
  };
}

export async function getCancellationInfo(
  ticketId: string,
  companyId: string
): Promise<CancellationInfo> {
  const session = await requireCompanyAccess(companyId);
  return _getCancellationInfoInternal(ticketId, companyId, session);
}

export async function requestCancellation(
  ticketId: string,
  companyId: string,
  type: CancellationType,
  justification: string
) {
  const session = await requireCompanyAccess(companyId);

  if (!justification?.trim()) {
    throw new Error("Justificativa é obrigatória");
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true, proposalId: true, boletoId: true, tags: true },
  });
  if (!ticket) throw new Error("Ticket não encontrado");

  // Validate the ticket has what the user wants to cancel
  if ((type === "proposal" || type === "both") && !ticket.proposalId) {
    throw new Error("Este ticket não possui proposta vinculada");
  }
  if ((type === "boletos" || type === "both") && !ticket.boletoId) {
    throw new Error("Este ticket não possui boleto vinculado");
  }

  // Check not already pending
  if (ticket.tags.includes("Cancelamento Pendente")) {
    throw new Error("Já existe uma solicitação de cancelamento pendente para este ticket");
  }

  const typeLabel =
    type === "proposal" ? "Proposta" : type === "boletos" ? "Boletos" : "Proposta e Boletos";

  await prisma.$transaction(async (tx) => {
    // Add tag
    await tx.ticket.update({
      where: { id: ticketId },
      data: { tags: { push: "Cancelamento Pendente" } },
    });

    // Create structured internal note (for parsing on approval)
    await tx.ticketMessage.create({
      data: {
        ticketId,
        senderId: session.userId,
        content: `[CANCELAMENTO] Tipo: ${type} | Justificativa: ${justification.trim()}`,
        direction: "OUTBOUND",
        origin: "SYSTEM",
        isInternal: true,
      },
    });

    // Visible timeline event
    await tx.ticketMessage.create({
      data: {
        ticketId,
        senderId: session.userId,
        content: `Solicitação de cancelamento: ${typeLabel}. Aguardando aprovação de gestor/admin.\nJustificativa: ${justification.trim()}`,
        direction: "OUTBOUND",
        origin: "SYSTEM",
        isInternal: true,
      },
    });
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "CancellationRequest",
    entityId: ticketId,
    dataAfter: { type, justification: justification.trim() } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  invalidateKpiCache(companyId);
  sseBus.publish(`company:${companyId}:sac`, "sla-update", { timestamp: Date.now() });
  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId, timestamp: Date.now() });

  return { success: true };
}

export async function approveCancellation(
  ticketId: string,
  companyId: string
) {
  const session = await requireCompanyAccess(companyId);

  // Only ADMIN and MANAGER can approve
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    throw new Error("Acesso negado. Apenas administradores e gestores podem aprovar cancelamentos.");
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: {
      id: true,
      proposalId: true,
      boletoId: true,
      tags: true,
      clientId: true,
      subject: true,
    },
  });
  if (!ticket) throw new Error("Ticket não encontrado");

  if (!ticket.tags.includes("Cancelamento Pendente")) {
    throw new Error("Não há solicitação de cancelamento pendente");
  }

  // Find the cancellation request note to determine type
  const requestNote = await prisma.ticketMessage.findFirst({
    where: {
      ticketId,
      isInternal: true,
      content: { startsWith: "[CANCELAMENTO]" },
    },
    orderBy: { createdAt: "desc" },
  });

  const typeMatch = requestNote?.content.match(/Tipo:\s*(proposal|boletos|both)/);
  const type = (typeMatch?.[1] as CancellationType) ?? "both";

  const cancelledItems: string[] = [];

  await prisma.$transaction(async (tx) => {
    // Cancel proposal
    if ((type === "proposal" || type === "both") && ticket.proposalId) {
      await tx.proposal.update({
        where: { id: ticket.proposalId },
        data: { status: "CANCELLED" },
      });
      cancelledItems.push("Proposta");
    }

    // Cancel boletos
    if ((type === "boletos" || type === "both") && ticket.boletoId) {
      const boleto = await tx.boleto.findUnique({
        where: { id: ticket.boletoId },
        select: { id: true, status: true, proposalId: true },
      });
      if (boleto && !["PAID", "CANCELLED"].includes(boleto.status)) {
        await tx.boleto.update({
          where: { id: boleto.id },
          data: { status: "CANCELLED" },
        });
      }

      // Also cancel other boletos from the same proposal
      if (boleto?.proposalId) {
        await tx.boleto.updateMany({
          where: {
            proposalId: boleto.proposalId,
            status: { notIn: ["PAID", "CANCELLED"] },
          },
          data: { status: "CANCELLED" },
        });
      }

      cancelledItems.push("Boleto(s)");

      // Cancel pending AccountReceivable for the client
      await tx.accountReceivable.updateMany({
        where: {
          clientId: ticket.clientId,
          companyId,
          status: "PENDING",
        },
        data: {
          status: "CANCELLED",
        },
      });
      cancelledItems.push("Contas a Receber pendentes");
    }

    // Remove "Cancelamento Pendente" tag
    const newTags = ticket.tags.filter((t) => t !== "Cancelamento Pendente");
    await tx.ticket.update({
      where: { id: ticketId },
      data: { tags: newTags },
    });

    // Timeline event as proof
    await tx.ticketMessage.create({
      data: {
        ticketId,
        senderId: session.userId,
        content: `Cancelamento aprovado e executado. Itens cancelados: ${cancelledItems.join(", ")}.`,
        direction: "OUTBOUND",
        origin: "SYSTEM",
        isInternal: true,
      },
    });
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "CancellationApproval",
    entityId: ticketId,
    dataAfter: {
      type,
      cancelledItems,
      proposalId: ticket.proposalId,
      boletoId: ticket.boletoId,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  invalidateKpiCache(companyId);
  sseBus.publish(`company:${companyId}:sac`, "sla-update", { timestamp: Date.now() });
  sseBus.publish(`company:${companyId}:sac`, "timeline-update", { ticketId, timestamp: Date.now() });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Aggregated Bootstrap — single roundtrip for ticket detail page
// ---------------------------------------------------------------------------

export interface TicketDetailBootstrap {
  ticket: TicketDetail;
  financialSummary: ClientFinancialSummary;
  refunds: RefundSummary[];
  cancellation: CancellationInfo | null;
  aiEnabled: boolean;
  users: { id: string; name: string }[];
  userRole: string;
}

export async function getTicketDetailBootstrap(
  ticketId: string,
  companyId: string
): Promise<TicketDetailBootstrap | null> {
  const session = await requireCompanyAccess(companyId);

  const ticket = await _getTicketByIdInternal(ticketId, companyId, session);
  if (!ticket) return null;

  const [financialSummary, refunds, cancellation, aiEnabled, users, userRole] =
    await Promise.all([
      _getClientFinancialSummaryInternal(ticket.client.id, companyId, session),
      _getTicketRefundsInternal(ticketId, companyId, session),
      _getCancellationInfoInternal(ticketId, companyId, session),
      _getAiConfigEnabledInternal(companyId, session),
      _listUsersForAssignInternal(companyId, session),
      _getUserRoleInternal(companyId, session),
    ]);

  return {
    ticket,
    financialSummary,
    refunds,
    cancellation,
    aiEnabled,
    users,
    userRole,
  };
}

// ---------------------------------------------------------------------------
// Kanban Bootstrap — single roundtrip for kanban view (SAC Evolution S3)
// ---------------------------------------------------------------------------

export interface KanbanColumnData {
  data: TicketRow[];
  total: number;
}

export type KanbanBootstrapResult = Record<TicketStatus, KanbanColumnData>;

export async function getKanbanBootstrap(
  companyId: string,
  channelType?: ChannelType
): Promise<KanbanBootstrapResult> {
  const session = await requireCompanyAccess(companyId);

  const statuses: TicketStatus[] = [
    "OPEN",
    "IN_PROGRESS",
    "WAITING_CLIENT",
    "RESOLVED",
    "CLOSED",
  ];

  const results = await Promise.all(
    statuses.map((status) =>
      _listTicketsInternal(
        { companyId, status, channelType, pageSize: 100 },
        session
      )
    )
  );

  return Object.fromEntries(
    statuses.map((status, i) => [
      status,
      { data: results[i].data, total: results[i].total },
    ])
  ) as KanbanBootstrapResult;
}
