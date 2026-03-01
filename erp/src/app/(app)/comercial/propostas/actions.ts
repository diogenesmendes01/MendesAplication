"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma, type ProposalStatus } from "@prisma/client";

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

export interface ProposalItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateProposalInput {
  clientId: string;
  paymentConditions?: string;
  validity?: string;
  observations?: string;
  items: ProposalItemInput[];
}

export interface UpdateProposalInput {
  id: string;
  clientId: string;
  paymentConditions?: string;
  validity?: string;
  observations?: string;
  items: ProposalItemInput[];
}

export interface ListProposalsParams {
  companyId: string;
  page?: number;
  pageSize?: number;
  status?: ProposalStatus;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  valueMin?: number;
  valueMax?: number;
}

export interface ProposalItemRow {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface ProposalRow {
  id: string;
  clientId: string;
  clientName: string;
  status: ProposalStatus;
  paymentConditions: string | null;
  validity: string | null;
  observations: string | null;
  totalValue: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalDetail extends ProposalRow {
  items: ProposalItemRow[];
}

export interface ClientOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Status Transitions
// ---------------------------------------------------------------------------

const VALID_STATUS_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateTotalValue(items: ProposalItemInput[]): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const item of items) {
    const qty = new Prisma.Decimal(item.quantity);
    const price = new Prisma.Decimal(item.unitPrice);
    total = total.add(qty.mul(price));
  }
  return total;
}

function validateProposalInput(
  input: CreateProposalInput | UpdateProposalInput
) {
  if (!input.clientId?.trim()) {
    throw new Error("Cliente é obrigatório");
  }
  if (!input.items || input.items.length === 0) {
    throw new Error("A proposta deve ter pelo menos um item");
  }
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    if (!item.description?.trim()) {
      throw new Error(`Item ${i + 1}: descrição é obrigatória`);
    }
    if (!item.quantity || item.quantity <= 0) {
      throw new Error(`Item ${i + 1}: quantidade deve ser maior que zero`);
    }
    if (!item.unitPrice || item.unitPrice <= 0) {
      throw new Error(`Item ${i + 1}: preço unitário deve ser maior que zero`);
    }
  }
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function listProposals(
  params: ListProposalsParams
): Promise<PaginatedResult<ProposalRow>> {
  await requireCompanyAccess(params.companyId);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where: Prisma.ProposalWhereInput = {
    companyId: params.companyId,
  };

  if (params.status) {
    where.status = params.status;
  }

  if (params.clientId) {
    where.clientId = params.clientId;
  }

  if (params.dateFrom || params.dateTo) {
    where.createdAt = {};
    if (params.dateFrom) {
      where.createdAt.gte = new Date(params.dateFrom);
    }
    if (params.dateTo) {
      const end = new Date(params.dateTo);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  if (params.valueMin !== undefined || params.valueMax !== undefined) {
    where.totalValue = {};
    if (params.valueMin !== undefined) {
      where.totalValue.gte = new Prisma.Decimal(params.valueMin);
    }
    if (params.valueMax !== undefined) {
      where.totalValue.lte = new Prisma.Decimal(params.valueMax);
    }
  }

  const [rows, total] = await Promise.all([
    prisma.proposal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    }),
    prisma.proposal.count({ where }),
  ]);

  const data: ProposalRow[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    status: r.status,
    paymentConditions: r.paymentConditions,
    validity: r.validity?.toISOString() ?? null,
    observations: r.observations,
    totalValue: r.totalValue.toString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function createProposal(
  input: CreateProposalInput,
  companyId: string
) {
  const session = await requireCompanyAccess(companyId);
  validateProposalInput(input);

  // Verify client belongs to this company
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, companyId },
  });
  if (!client) {
    throw new Error("Cliente não encontrado nesta empresa");
  }

  const totalValue = calculateTotalValue(input.items);

  const proposal = await prisma.proposal.create({
    data: {
      clientId: input.clientId,
      status: "DRAFT",
      paymentConditions: input.paymentConditions?.trim() || null,
      validity: input.validity ? new Date(input.validity) : null,
      observations: input.observations?.trim() || null,
      totalValue,
      companyId,
      items: {
        create: input.items.map((item) => ({
          description: item.description.trim(),
          quantity: new Prisma.Decimal(item.quantity),
          unitPrice: new Prisma.Decimal(item.unitPrice),
        })),
      },
    },
    include: {
      items: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Proposal",
    entityId: proposal.id,
    dataAfter: {
      clientId: proposal.clientId,
      status: proposal.status,
      totalValue: proposal.totalValue.toString(),
      itemCount: proposal.items.length,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { id: proposal.id };
}

export async function updateProposal(
  input: UpdateProposalInput,
  companyId: string
) {
  const session = await requireCompanyAccess(companyId);
  validateProposalInput(input);

  const existing = await prisma.proposal.findFirst({
    where: { id: input.id, companyId },
    include: { items: true },
  });
  if (!existing) {
    throw new Error("Proposta não encontrada");
  }
  if (existing.status !== "DRAFT") {
    throw new Error("Somente propostas em rascunho podem ser editadas");
  }

  // Verify client belongs to this company
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, companyId },
  });
  if (!client) {
    throw new Error("Cliente não encontrado nesta empresa");
  }

  const totalValue = calculateTotalValue(input.items);

  const proposal = await prisma.$transaction(async (tx) => {
    // Delete old items
    await tx.proposalItem.deleteMany({
      where: { proposalId: input.id },
    });

    // Update proposal and create new items
    return tx.proposal.update({
      where: { id: input.id },
      data: {
        clientId: input.clientId,
        paymentConditions: input.paymentConditions?.trim() || null,
        validity: input.validity ? new Date(input.validity) : null,
        observations: input.observations?.trim() || null,
        totalValue,
        items: {
          create: input.items.map((item) => ({
            description: item.description.trim(),
            quantity: new Prisma.Decimal(item.quantity),
            unitPrice: new Prisma.Decimal(item.unitPrice),
          })),
        },
      },
      include: { items: true },
    });
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Proposal",
    entityId: input.id,
    dataBefore: {
      clientId: existing.clientId,
      totalValue: existing.totalValue.toString(),
      itemCount: existing.items.length,
    } as unknown as Prisma.InputJsonValue,
    dataAfter: {
      clientId: proposal.clientId,
      totalValue: proposal.totalValue.toString(),
      itemCount: proposal.items.length,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { id: proposal.id };
}

export async function getProposalById(proposalId: string, companyId: string): Promise<ProposalDetail> {
  await requireCompanyAccess(companyId);

  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, companyId },
    include: {
      client: {
        select: { id: true, name: true },
      },
      items: {
        orderBy: { id: "asc" },
      },
    },
  });

  if (!proposal) {
    throw new Error("Proposta não encontrada");
  }

  return {
    id: proposal.id,
    clientId: proposal.clientId,
    clientName: proposal.client.name,
    status: proposal.status,
    paymentConditions: proposal.paymentConditions,
    validity: proposal.validity?.toISOString() ?? null,
    observations: proposal.observations,
    totalValue: proposal.totalValue.toString(),
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    items: proposal.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
    })),
  };
}

export async function updateProposalStatus(
  proposalId: string,
  newStatus: ProposalStatus,
  companyId: string
) {
  const session = await requireCompanyAccess(companyId);

  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, companyId },
  });
  if (!proposal) {
    throw new Error("Proposta não encontrada");
  }

  const allowedTransitions = VALID_STATUS_TRANSITIONS[proposal.status];
  if (!allowedTransitions.includes(newStatus)) {
    throw new Error(
      `Transição de status inválida: ${proposal.status} → ${newStatus}`
    );
  }

  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: newStatus },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "Proposal",
    entityId: proposalId,
    dataBefore: { status: proposal.status },
    dataAfter: { status: newStatus },
    companyId,
  });

  return { success: true };
}

export async function listClientsForProposal(
  companyId: string
): Promise<ClientOption[]> {
  await requireCompanyAccess(companyId);

  const clients = await prisma.client.findMany({
    where: { companyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return clients;
}
