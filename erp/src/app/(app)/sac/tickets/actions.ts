"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { getSlaStatus, type SlaStatusValue } from "@/lib/sla";
import { Prisma, type TicketStatus, type TicketPriority, type ChannelType, type MessageDirection, type MessageOrigin, type RefundStatus } from "@prisma/client";
import { getSharedCompanyIds } from "@/lib/shared-clients";

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
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function listTickets(
  params: ListTicketsParams
): Promise<PaginatedResult<TicketRow>> {
  const session = await requireCompanyAccess(params.companyId);

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

  // Fetch SLA alert configs for at-risk calculation
  const slaConfigs = await prisma.slaConfig.findMany({
    where: { companyId: params.companyId, type: "TICKET" },
    select: { priority: true, stage: true, alertBeforeMinutes: true },
  });
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
    };
  });

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** Get counts for tab badges */
export async function getTicketTabCounts(companyId: string): Promise<{
  slaCritical: number;
  refunds: number;
}> {
  await requireCompanyAccess(companyId);

  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 60_000);

  const [slaCritical, refunds] = await Promise.all([
    prisma.ticket.count({
      where: {
        companyId,
        status: { notIn: ["RESOLVED", "CLOSED"] },
        OR: [
          { slaBreached: true },
          { slaResolution: { not: null, lte: soon } },
          { slaFirstReply: { not: null, lte: soon } },
        ],
      },
    }),
    prisma.ticket.count({
      where: {
        companyId,
        refunds: { some: {} },
      },
    }),
  ]);

  return { slaCritical, refunds };
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

export async function listUsersForAssign(companyId: string) {
  await requireCompanyAccess(companyId);

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
}

export async function getTicketById(
  ticketId: string,
  companyId: string
): Promise<TicketDetail> {
  await requireCompanyAccess(companyId);

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
  };
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

  return { status: updated.status };
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
      console.error("Failed to send ticket reply email");
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
  sender: { id: string; name: string } | null;
  contactName: string | null;
  contactRole: string | null;
  attachments: TimelineAttachment[];
  refundAmount: string | null;
  refundStatus: RefundStatus | null;
  oldStatus: string | null;
  newStatus: string | null;
}

export async function listTimelineEvents(
  ticketId: string,
  companyId: string
): Promise<TimelineEvent[]> {
  await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: { id: true },
  });

  if (!ticket) {
    throw new Error("Ticket não encontrado");
  }

  const [messages, refunds, statusChanges] = await Promise.all([
    prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
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
      where: { ticketId },
      include: {
        requestedBy: { select: { name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        entityId: ticketId,
        entity: "Ticket",
        action: "STATUS_CHANGE",
      },
      include: {
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
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
      sender: null,
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

  return events;
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

export async function sendEmailReply(
  ticketId: string,
  companyId: string,
  to: string,
  subject: string,
  content: string,
  attachmentIds?: string[]
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

  const message = await prisma.ticketMessage.create({
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

  if (attachmentIds?.length) {
    await prisma.attachment.updateMany({
      where: { id: { in: attachmentIds } },
      data: { ticketMessageId: message.id },
    });
  }

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
      attachmentIds: attachmentIds ?? [],
    });
  } catch (err) {
    console.error("Failed to enqueue email-outbound job:", err);
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

  if (ticket.client.telefone) {
    recipients.push({
      phone: ticket.client.telefone,
      name: ticket.client.name,
      role: "Cliente",
    });
  }

  for (const c of ticket.client.additionalContacts) {
    if (c.whatsapp) {
      recipients.push({
        phone: c.whatsapp,
        name: c.name,
        role: c.role,
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
  attachmentIds?: string[]
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

  const message = await prisma.ticketMessage.create({
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

  if (attachmentIds?.length) {
    await prisma.attachment.updateMany({
      where: { id: { in: attachmentIds } },
      data: { ticketMessageId: message.id },
    });
  }

  // Enqueue WhatsApp send job
  try {
    const { whatsappOutboundQueue } = await import("@/lib/queue");
    await whatsappOutboundQueue.add("send-whatsapp", {
      messageId: message.id,
      ticketId,
      companyId,
      to,
      content: content.trim(),
      attachmentIds: attachmentIds ?? [],
    });
  } catch (err) {
    console.error("Failed to enqueue whatsapp-outbound job:", err);
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

export async function getClientFinancialSummary(
  clientId: string,
  companyId: string
): Promise<ClientFinancialSummary> {
  await requireCompanyAccess(companyId);

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
