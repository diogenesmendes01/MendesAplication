"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma, type TicketStatus, type TicketPriority } from "@prisma/client";

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

export interface ListTicketsParams {
  companyId: string;
  page?: number;
  pageSize?: number;
  status?: TicketStatus;
  priority?: TicketPriority;
  clientId?: string;
  assigneeId?: string;
  search?: string;
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
  await requireCompanyAccess(params.companyId);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where: Prisma.TicketWhereInput = {
    companyId: params.companyId,
  };

  if (params.status) {
    where.status = params.status;
  }

  if (params.priority) {
    where.priority = params.priority;
  }

  if (params.clientId) {
    where.clientId = params.clientId;
  }

  if (params.assigneeId) {
    where.assigneeId = params.assigneeId;
  }

  if (params.search) {
    where.subject = { contains: params.search, mode: "insensitive" };
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
      },
    }),
    prisma.ticket.count({ where }),
  ]);

  const data: TicketRow[] = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    priority: r.priority,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    client: r.client,
    assignee: r.assignee,
  }));

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
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

  return prisma.client.findMany({
    where: { companyId },
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
