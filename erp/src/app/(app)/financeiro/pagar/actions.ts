"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma, type PaymentStatus, type Recurrence } from "@prisma/client";

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

export interface ListPayablesParams {
  companyId: string;
  page?: number;
  pageSize?: number;
  status?: PaymentStatus;
  supplier?: string;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreatePayableInput {
  companyId: string;
  supplier: string;
  description: string;
  value: number;
  dueDate: string;
  categoryId?: string;
  recurrence: Recurrence;
}

export interface UpdatePayableInput {
  id: string;
  companyId: string;
  supplier: string;
  description: string;
  value: number;
  dueDate: string;
  categoryId?: string;
  recurrence: Recurrence;
}

export interface PayableRow {
  id: string;
  supplier: string;
  description: string;
  value: string;
  dueDate: string;
  status: PaymentStatus;
  recurrence: Recurrence;
  paidAt: string | null;
  createdAt: string;
  category: {
    id: string;
    name: string;
  } | null;
  origin: string;
  refundId: string | null;
  ticketId: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface PayableAlertSummary {
  dueThisWeek: number;
  overdue: number;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Auto-update PENDING payables whose dueDate has passed to OVERDUE,
 * then return summary counts for the alert banner.
 */
export async function getPayableAlerts(
  companyId: string
): Promise<PayableAlertSummary> {
  await requireCompanyAccess(companyId);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Auto-update: mark PENDING items with past due date as OVERDUE
  await prisma.accountPayable.updateMany({
    where: {
      companyId,
      status: "PENDING",
      dueDate: { lt: startOfToday },
    },
    data: { status: "OVERDUE" },
  });

  // Count overdue items
  const overdue = await prisma.accountPayable.count({
    where: {
      companyId,
      status: "OVERDUE",
    },
  });

  // Count items due within the next 7 days (PENDING only, not already paid/overdue)
  const sevenDaysFromNow = new Date(startOfToday);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const dueThisWeek = await prisma.accountPayable.count({
    where: {
      companyId,
      status: "PENDING",
      dueDate: {
        gte: startOfToday,
        lte: sevenDaysFromNow,
      },
    },
  });

  return { dueThisWeek, overdue };
}

export async function listPayables(
  params: ListPayablesParams
): Promise<PaginatedResult<PayableRow>> {
  await requireCompanyAccess(params.companyId);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where: Prisma.AccountPayableWhereInput = {
    companyId: params.companyId,
  };

  if (params.status) {
    where.status = params.status;
  }

  if (params.supplier) {
    where.supplier = { contains: params.supplier, mode: "insensitive" };
  }

  if (params.categoryId) {
    where.categoryId = params.categoryId;
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
    prisma.accountPayable.findMany({
      where,
      orderBy: { dueDate: "asc" },
      skip,
      take: pageSize,
      include: {
        category: {
          select: { id: true, name: true },
        },
        refund: {
          select: { ticketId: true },
        },
      },
    }),
    prisma.accountPayable.count({ where }),
  ]);

  const data: PayableRow[] = rows.map((r) => ({
    id: r.id,
    supplier: r.supplier,
    description: r.description,
    value: r.value.toString(),
    dueDate: r.dueDate.toISOString(),
    status: r.status,
    recurrence: r.recurrence,
    paidAt: r.paidAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    category: r.category,
    origin: r.origin,
    refundId: r.refundId,
    ticketId: r.refund?.ticketId ?? null,
  }));

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function createPayable(input: CreatePayableInput) {
  const session = await requireCompanyAccess(input.companyId);

  if (!input.supplier?.trim()) {
    throw new Error("Fornecedor é obrigatório");
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

  if (input.categoryId) {
    const category = await prisma.financialCategory.findFirst({
      where: { id: input.categoryId, companyId: input.companyId },
    });
    if (!category) {
      throw new Error("Categoria não encontrada nesta empresa");
    }
  }

  const payable = await prisma.accountPayable.create({
    data: {
      supplier: input.supplier.trim(),
      description: input.description.trim(),
      value: new Prisma.Decimal(input.value),
      dueDate: new Date(input.dueDate),
      categoryId: input.categoryId || null,
      recurrence: input.recurrence || "NONE",
      companyId: input.companyId,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "AccountPayable",
    entityId: payable.id,
    dataAfter: {
      supplier: payable.supplier,
      description: payable.description,
      value: payable.value.toString(),
      dueDate: payable.dueDate.toISOString(),
      recurrence: payable.recurrence,
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  return { id: payable.id };
}

export async function updatePayable(input: UpdatePayableInput) {
  const session = await requireCompanyAccess(input.companyId);

  if (!input.supplier?.trim()) {
    throw new Error("Fornecedor é obrigatório");
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

  const existing = await prisma.accountPayable.findFirst({
    where: { id: input.id, companyId: input.companyId },
  });
  if (!existing) {
    throw new Error("Conta a pagar não encontrada");
  }
  if (existing.status === "PAID") {
    throw new Error("Não é possível editar uma conta já paga");
  }

  if (input.categoryId) {
    const category = await prisma.financialCategory.findFirst({
      where: { id: input.categoryId, companyId: input.companyId },
    });
    if (!category) {
      throw new Error("Categoria não encontrada nesta empresa");
    }
  }

  const updated = await prisma.accountPayable.update({
    where: { id: input.id },
    data: {
      supplier: input.supplier.trim(),
      description: input.description.trim(),
      value: new Prisma.Decimal(input.value),
      dueDate: new Date(input.dueDate),
      categoryId: input.categoryId || null,
      recurrence: input.recurrence || "NONE",
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "AccountPayable",
    entityId: input.id,
    dataBefore: {
      supplier: existing.supplier,
      description: existing.description,
      value: existing.value.toString(),
      dueDate: existing.dueDate.toISOString(),
      recurrence: existing.recurrence,
    } as unknown as Prisma.InputJsonValue,
    dataAfter: {
      supplier: updated.supplier,
      description: updated.description,
      value: updated.value.toString(),
      dueDate: updated.dueDate.toISOString(),
      recurrence: updated.recurrence,
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  return { id: updated.id };
}

export async function markPayableAsPaid(
  id: string,
  companyId: string,
  paidAt?: Date,
  notes?: string
) {
  const session = await requireCompanyAccess(companyId);

  const payable = await prisma.accountPayable.findFirst({
    where: { id, companyId },
  });
  if (!payable) {
    throw new Error("Conta a pagar não encontrada");
  }
  if (payable.status === "PAID") {
    throw new Error("Esta conta já foi paga");
  }

  const effectivePaidAt = paidAt ?? new Date();

  const updated = await prisma.accountPayable.update({
    where: { id },
    data: {
      status: "PAID",
      paidAt: effectivePaidAt,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "AccountPayable",
    entityId: id,
    dataBefore: { status: payable.status },
    dataAfter: {
      status: "PAID",
      paidAt: updated.paidAt?.toISOString(),
      ...(notes ? { notes } : {}),
    },
    companyId,
  });

  return { success: true };
}

export async function listCategoriesForSelect(companyId: string): Promise<CategoryOption[]> {
  await requireCompanyAccess(companyId);

  const categories = await prisma.financialCategory.findMany({
    where: { companyId, type: "EXPENSE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return categories;
}
