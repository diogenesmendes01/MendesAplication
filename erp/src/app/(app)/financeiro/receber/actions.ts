"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma, type PaymentStatus } from "@prisma/client";
import Decimal from "decimal.js";
import { getSharedCompanyIds } from "@/lib/shared-clients";
import { withLogging } from "@/lib/with-logging";

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

export interface ListReceivablesParams {
  companyId: string;
  page?: number;
  pageSize?: number;
  status?: PaymentStatus;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateReceivableInput {
  companyId: string;
  clientId: string;
  description: string;
  value: number;
  dueDate: string;
}

export interface ReceivableRow {
  id: string;
  description: string;
  value: string;
  dueDate: string;
  status: PaymentStatus;
  paidAt: string | null;
  createdAt: string;
  client: {
    id: string;
    name: string;
  };
  providerName: string | null;
  manualOverride: boolean;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

async function _listReceivables(
  params: ListReceivablesParams
): Promise<PaginatedResult<ReceivableRow>> {
  await requireCompanyAccess(params.companyId);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where: Prisma.AccountReceivableWhereInput = {
    companyId: params.companyId,
  };

  if (params.status) {
    where.status = params.status;
  }

  if (params.clientId) {
    where.clientId = params.clientId;
  }

  if (params.dateFrom || params.dateTo) {
    where.dueDate = {};
    if (params.dateFrom) {
      where.dueDate.gte = new Date(params.dateFrom);
    }
    if (params.dateTo) {
      const end = new Date(params.dateTo);
      end.setHours(23, 59, 59, 999);
      where.dueDate.lte = end;
    }
  }

  const [rows, total] = await Promise.all([
    prisma.accountReceivable.findMany({
      where,
      orderBy: { dueDate: "asc" },
      skip,
      take: pageSize,
      include: {
        client: {
          select: { id: true, name: true },
        },
        boleto: {
          select: {
            provider: { select: { name: true } },
            manualOverride: true,
          },
        },
      },
    }),
    prisma.accountReceivable.count({ where }),
  ]);

  const data: ReceivableRow[] = rows.map((r) => {
    return {
      id: r.id,
      description: r.description,
      value: r.value.toString(),
      dueDate: r.dueDate.toISOString(),
      status: r.status,
      paidAt: r.paidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      client: r.client,
      providerName: r.boleto?.provider?.name ?? null,
      manualOverride: r.boleto?.manualOverride ?? false,
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

async function _createReceivable(input: CreateReceivableInput) {
  const session = await requireCompanyAccess(input.companyId);

  if (!input.clientId?.trim()) {
    throw new Error("Cliente é obrigatório");
  }
  if (!input.description?.trim()) {
    throw new Error("Descrição é obrigatória");
  }
  if (!input.value || input.value <= 0) {
    throw new Error("Valor deve ser maior que zero");
  }
  if (!input.dueDate) {
    throw new Error("Data de vencimento é obrigatória");
  }

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, companyId: input.companyId },
  });
  if (!client) {
    throw new Error("Cliente não encontrado nesta empresa");
  }

  const receivable = await prisma.accountReceivable.create({
    data: {
      clientId: input.clientId,
      description: input.description.trim(),
      value: new Decimal(input.value),
      dueDate: new Date(input.dueDate),
      companyId: input.companyId,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "AccountReceivable",
    entityId: receivable.id,
    dataAfter: {
      clientId: receivable.clientId,
      description: receivable.description,
      value: receivable.value.toString(),
      dueDate: receivable.dueDate.toISOString(),
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  return { id: receivable.id };
}

async function _markReceivableAsPaid(
  id: string,
  companyId: string,
  paidAt?: Date,
  notes?: string
) {
  const session = await requireCompanyAccess(companyId);

  const receivable = await prisma.accountReceivable.findFirst({
    where: { id, companyId },
  });
  if (!receivable) {
    throw new Error("Conta a receber não encontrada");
  }
  if (receivable.status === "PAID") {
    throw new Error("Esta conta já foi paga");
  }

  const effectivePaidAt = paidAt ?? new Date();

  const updated = await prisma.accountReceivable.update({
    where: { id },
    data: {
      status: "PAID",
      paidAt: effectivePaidAt,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "AccountReceivable",
    entityId: id,
    dataBefore: { status: receivable.status },
    dataAfter: {
      status: "PAID",
      paidAt: updated.paidAt?.toISOString(),
      ...(notes ? { notes } : {}),
    },
    companyId,
  });

  return { success: true };
}

async function _listClientsForSelect(companyId: string) {
  await requireCompanyAccess(companyId);

  const sharedIds = await getSharedCompanyIds(companyId);
  const clients = await prisma.client.findMany({
    where: { companyId: { in: sharedIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return clients;
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
export const listReceivables = withLogging('receber.listReceivables', _listReceivables);
export const createReceivable = withLogging('receber.createReceivable', _createReceivable);
export const markReceivableAsPaid = withLogging('receber.markReceivableAsPaid', _markReceivableAsPaid);
export const listClientsForSelect = withLogging('receber.listClientsForSelect', _listClientsForSelect);
