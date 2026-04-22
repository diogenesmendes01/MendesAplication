"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { type InvoiceStatus, Prisma } from "@prisma/client";
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

export interface ListInvoicesParams {
  companyId: string;
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface InvoiceRow {
  id: string;
  nfNumber: string | null;
  serviceDescription: string;
  value: string;
  issRate: string;
  status: InvoiceStatus;
  createdAt: string;
  client: {
    id: string;
    name: string;
  };
  proposal: {
    id: string;
  } | null;
  boleto: {
    id: string;
    bankReference: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

async function _listInvoices(
  params: ListInvoicesParams
): Promise<PaginatedResult<InvoiceRow>> {
  await requireCompanyAccess(params.companyId);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where: Prisma.InvoiceWhereInput = {
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

  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        client: {
          select: { id: true, name: true },
        },
        proposal: {
          select: { id: true },
        },
        boleto: {
          select: { id: true, bankReference: true },
        },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  const data: InvoiceRow[] = rows.map((r) => ({
    id: r.id,
    nfNumber: r.nfNumber,
    serviceDescription: r.serviceDescription,
    value: r.value.toString(),
    issRate: r.issRate.toString(),
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    client: r.client,
    proposal: r.proposal,
    boleto: r.boleto,
  }));

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
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

/**
 * Cancel an issued invoice.
 */
async function _cancelInvoice(
  invoiceId: string,
  companyId: string,
  motivo = "Erro na emissão"
) {
  const session = await requireCompanyAccess(companyId);

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    include: {
      company: {
        select: { cnpj: true },
      },
    },
  });

  if (!invoice) {
    throw new Error("Nota fiscal não encontrada");
  }

  if (invoice.status === "CANCELLED") {
    throw new Error("Esta nota fiscal já foi cancelada");
  }

  if (invoice.status === "PENDING") {
    throw new Error("Não é possível cancelar uma nota fiscal pendente");
  }

  // Notificar a prefeitura antes de atualizar o banco
  // Se o cancelamento falhar na prefeitura, o status no banco NÃO é alterado
  const { getNfseProviderForCompany } = await import("@/lib/nfse");
  const { getCachedFiscalConfig } = await import(
    "@/app/(app)/configuracoes/fiscal/actions"
  );

  const fiscalConfig = await getCachedFiscalConfig(companyId);
  const provider = await getNfseProviderForCompany(companyId);

  await provider.cancelNFSe({
    nfNumber: invoice.nfNumber!,
    cnpj: invoice.company.cnpj,
    inscricaoMunicipal: fiscalConfig.inscricaoMunicipal,
    motivo,
  });

  // Prefeitura aceitou — agora atualiza o banco
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "CANCELLED",
      cancellationReason: motivo,
      cancelledAt: new Date(),
    },
  });

  // Cancel associated TaxEntries
  await prisma.taxEntry.updateMany({
    where: { invoiceId, status: { not: "CANCELLED" } },
    data: { status: "CANCELLED" },
  });

  const { logAuditEvent } = await import("@/lib/audit");
  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "Invoice",
    entityId: invoiceId,
    dataBefore: { status: invoice.status },
    dataAfter: { status: "CANCELLED" },
    companyId,
  });

  return { success: true };
}

/**
 * Manually emit a PENDING invoice (retry after auto-emit failure).
 * Deletes the PENDING record first (emitInvoiceForBoleto checks for duplicates),
 * then recreates it if emission fails so the user can retry.
 */
async function _emitPendingInvoice(invoiceId: string, companyId: string) {
  await requireCompanyAccess(companyId);

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId, status: "PENDING" },
  });

  if (!invoice) {
    throw new Error("Nota fiscal não encontrada ou não está pendente");
  }

  if (!invoice.boletoId) {
    throw new Error("Nota fiscal não possui boleto vinculado");
  }

  // Delete the PENDING invoice so emitInvoiceForBoleto can create a new ISSUED one
  await prisma.invoice.delete({ where: { id: invoiceId } });

  try {
    const { emitInvoiceForBoleto } = await import("@/lib/nfse-actions");
    return await emitInvoiceForBoleto(invoice.boletoId, companyId);
  } catch (err) {
    // Emission failed — recreate the PENDING invoice so the user can retry
    const existing = await prisma.invoice.findFirst({
      where: { boletoId: invoice.boletoId, companyId },
    });
    if (!existing) {
      await prisma.invoice.create({
        data: {
          proposalId: invoice.proposalId,
          boletoId: invoice.boletoId,
          clientId: invoice.clientId,
          serviceDescription: invoice.serviceDescription,
          value: invoice.value,
          issRate: invoice.issRate,
          status: "PENDING",
          companyId,
        },
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
const _wrapped_listInvoices = withLogging('notasFiscais.listInvoices', _listInvoices);
export async function listInvoices(...args: Parameters<typeof _listInvoices>) { return _wrapped_listInvoices(...args); }
const _wrapped_listClientsForSelect = withLogging('notasFiscais.listClientsForSelect', _listClientsForSelect);
export async function listClientsForSelect(...args: Parameters<typeof _listClientsForSelect>) { return _wrapped_listClientsForSelect(...args); }
const _wrapped_cancelInvoice = withLogging('notasFiscais.cancelInvoice', _cancelInvoice);
export async function cancelInvoice(...args: Parameters<typeof _cancelInvoice>) { return _wrapped_cancelInvoice(...args); }
const _wrapped_emitPendingInvoice = withLogging('notasFiscais.emitPendingInvoice', _emitPendingInvoice);
export async function emitPendingInvoice(...args: Parameters<typeof _emitPendingInvoice>) { return _wrapped_emitPendingInvoice(...args); }
