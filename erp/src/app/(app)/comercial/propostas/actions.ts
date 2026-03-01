"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma, type ProposalStatus, type BoletoStatus } from "@prisma/client";
import { generateBoleto } from "@/lib/boleto";

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
  clientEmail: string | null;
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
        select: { id: true, name: true, email: true },
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
    clientEmail: proposal.client.email,
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

// ---------------------------------------------------------------------------
// Boleto Types
// ---------------------------------------------------------------------------

export interface GenerateBoletosInput {
  proposalId: string;
  companyId: string;
  installments: number;
  firstDueDate: string;
}

export interface BoletoRow {
  id: string;
  bankReference: string | null;
  value: string;
  dueDate: string;
  installmentNumber: number;
  status: BoletoStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Boleto Server Actions
// ---------------------------------------------------------------------------

export async function generateBoletosForProposal(
  input: GenerateBoletosInput
): Promise<{ boletos: BoletoRow[] }> {
  const session = await requireCompanyAccess(input.companyId);

  if (!input.installments || input.installments < 1) {
    throw new Error("Número de parcelas deve ser pelo menos 1");
  }
  if (input.installments > 48) {
    throw new Error("Número máximo de parcelas é 48");
  }
  if (!input.firstDueDate) {
    throw new Error("Data do primeiro vencimento é obrigatória");
  }

  const proposal = await prisma.proposal.findFirst({
    where: { id: input.proposalId, companyId: input.companyId },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          cpfCnpj: true,
          email: true,
          endereco: true,
        },
      },
      company: {
        select: {
          razaoSocial: true,
          cnpj: true,
        },
      },
      boletos: true,
    },
  });

  if (!proposal) {
    throw new Error("Proposta não encontrada");
  }
  if (proposal.status !== "ACCEPTED") {
    throw new Error("Somente propostas aceitas podem gerar boletos");
  }
  if (proposal.boletos.length > 0) {
    throw new Error("Esta proposta já possui boletos gerados");
  }

  const totalValue = Number(proposal.totalValue);
  const installmentValue = Math.round((totalValue / input.installments) * 100) / 100;
  const firstDue = new Date(input.firstDueDate);

  const createdBoletos: BoletoRow[] = [];

  await prisma.$transaction(async (tx) => {
    for (let i = 1; i <= input.installments; i++) {
      // Calculate due date for this installment
      const dueDate = new Date(firstDue);
      dueDate.setMonth(dueDate.getMonth() + (i - 1));

      // Adjust last installment to handle rounding
      const value =
        i === input.installments
          ? Math.round((totalValue - installmentValue * (input.installments - 1)) * 100) / 100
          : installmentValue;

      // Generate boleto via provider
      const result = await generateBoleto({
        clientData: {
          name: proposal.client.name,
          cpfCnpj: proposal.client.cpfCnpj,
          email: proposal.client.email ?? "",
          endereco: proposal.client.endereco,
        },
        companyData: {
          razaoSocial: proposal.company.razaoSocial,
          cnpj: proposal.company.cnpj,
        },
        value,
        dueDate,
        installmentNumber: i,
        totalInstallments: input.installments,
        proposalId: input.proposalId,
      });

      // Create boleto record
      const boleto = await tx.boleto.create({
        data: {
          proposalId: input.proposalId,
          bankReference: result.bankReference,
          value: new Prisma.Decimal(value),
          dueDate,
          installmentNumber: i,
          status: "GENERATED",
          companyId: input.companyId,
        },
      });

      // Create corresponding account receivable entry
      await tx.accountReceivable.create({
        data: {
          clientId: proposal.clientId,
          description: `Boleto ${i}/${input.installments} - Proposta #${proposal.id.slice(-6)}`,
          value: new Prisma.Decimal(value),
          dueDate,
          status: "PENDING",
          companyId: input.companyId,
        },
      });

      createdBoletos.push({
        id: boleto.id,
        bankReference: boleto.bankReference,
        value: boleto.value.toString(),
        dueDate: boleto.dueDate.toISOString(),
        installmentNumber: boleto.installmentNumber,
        status: boleto.status,
        createdAt: boleto.createdAt.toISOString(),
      });
    }
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Boleto",
    entityId: input.proposalId,
    dataAfter: {
      proposalId: input.proposalId,
      installments: input.installments,
      totalValue: totalValue.toString(),
      boletoCount: createdBoletos.length,
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  return { boletos: createdBoletos };
}

export async function listBoletosForProposal(
  proposalId: string,
  companyId: string
): Promise<BoletoRow[]> {
  await requireCompanyAccess(companyId);

  const boletos = await prisma.boleto.findMany({
    where: { proposalId, companyId },
    orderBy: { installmentNumber: "asc" },
  });

  return boletos.map((b) => ({
    id: b.id,
    bankReference: b.bankReference,
    value: b.value.toString(),
    dueDate: b.dueDate.toISOString(),
    installmentNumber: b.installmentNumber,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
  }));
}

export async function updateBoletoStatus(
  boletoId: string,
  newStatus: BoletoStatus,
  companyId: string
) {
  const session = await requireCompanyAccess(companyId);

  const boleto = await prisma.boleto.findFirst({
    where: { id: boletoId, companyId },
  });
  if (!boleto) {
    throw new Error("Boleto não encontrado");
  }

  const VALID_BOLETO_TRANSITIONS: Record<BoletoStatus, BoletoStatus[]> = {
    GENERATED: ["SENT", "CANCELLED"],
    SENT: ["PAID", "OVERDUE", "CANCELLED"],
    PAID: [],
    OVERDUE: ["PAID", "CANCELLED"],
    CANCELLED: [],
  };

  const allowed = VALID_BOLETO_TRANSITIONS[boleto.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Transição de status inválida: ${boleto.status} → ${newStatus}`
    );
  }

  await prisma.boleto.update({
    where: { id: boletoId },
    data: { status: newStatus },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "Boleto",
    entityId: boletoId,
    dataBefore: { status: boleto.status },
    dataAfter: { status: newStatus },
    companyId,
  });

  return { success: true };
}
