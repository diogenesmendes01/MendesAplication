"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { getSlaStatus, type SlaStatusValue } from "@/lib/sla";
import { Prisma, type TicketStatus, type TicketPriority, type ChannelType } from "@prisma/client";
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
  client: { id: string; name: string; email: string | null };
  assignee: { id: string; name: string } | null;
  company: { id: string; nomeFantasia: string };
}

export async function getTicketById(
  ticketId: string,
  companyId: string
): Promise<TicketDetail> {
  await requireCompanyAccess(companyId);

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    include: {
      client: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true } },
      company: { select: { id: true, nomeFantasia: true } },
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
    client: ticket.client,
    assignee: ticket.assignee,
    company: ticket.company,
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
  };
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
