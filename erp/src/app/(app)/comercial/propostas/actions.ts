"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma, type ProposalStatus, type BoletoStatus } from "@prisma/client";
import { getSharedCompanyIds } from "@/lib/shared-clients";
import { getCachedFiscalConfig } from "@/app/(app)/configuracoes/fiscal/actions";
import { emitInvoiceForBoleto } from "@/lib/nfse-actions";
import { resolveProvider, getProviderById, previewRouting } from "@/lib/payment/router";
import { getGateway } from "@/lib/payment/factory";
import { decrypt } from "@/lib/encryption";
import type { CreateBoletoInput, CreateBoletoResult, PaymentGateway } from "@/lib/payment/types";

// ---------------------------------------------------------------------------
// Proposal Event Helper
// ---------------------------------------------------------------------------

async function createProposalEvent(
  proposalId: string,
  type: string,
  description: string,
  userId?: string
) {
  try {
    await prisma.proposalEvent.create({
      data: { proposalId, type, description, userId },
    });
  } catch (err) {
    // Não propagar erro de log — o evento principal não deve falhar por causa do log
    console.error("[ProposalEvent] Falha ao registrar evento:", err);
  }
}

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
  clientType: string | null;
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
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
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

/**
 * Bug #5 fix: Safe month addition that clamps to last day of target month.
 * Avoids JS Date pitfall where Jan 31 + 1 month = Mar 3.
 */
function addMonthsSafe(base: Date, months: number): Date {
  const result = new Date(base);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  // If the day overflowed (e.g., Jan 31 → Mar 3), clamp to last day of target month
  const expectedMonth = ((base.getMonth() + months) % 12 + 12) % 12;
  if (result.getMonth() !== expectedMonth) {
    // Set to day 0 of next month = last day of expected month
    result.setDate(0);
  }
  return result;
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

  await createProposalEvent(
    proposal.id,
    "CREATED",
    `Proposta criada com ${proposal.items.length} item(s). Valor total: R$ ${proposal.totalValue}.`,
    session.userId
  );

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
        select: { id: true, name: true, email: true, type: true },
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
    clientType: proposal.client.type,
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

  await createProposalEvent(
    proposalId,
    "STATUS_CHANGED",
    `Status alterado: ${proposal.status} → ${newStatus}.`,
    session.userId
  );

  return { success: true };
}

export async function listClientsForProposal(
  companyId: string
): Promise<ClientOption[]> {
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
// Boleto Types
// ---------------------------------------------------------------------------

export interface GenerateBoletosInput {
  proposalId: string;
  companyId: string;
  installments: number;
  firstDueDate: string;
  providerId?: string | null;
}

export interface BoletoRow {
  id: string;
  bankReference: string | null;
  value: string;
  dueDate: string;
  installmentNumber: number;
  status: BoletoStatus;
  createdAt: string;
  providerName: string | null;
  manualOverride: boolean;
  gatewayData: {
    url?: string | null;
    line?: string | null;
    barcode?: string | null;
    qrCode?: string | null;
    pdf?: string | null;
    nossoNumero?: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Provider Selection Types & Actions (US-011)
// ---------------------------------------------------------------------------

export interface ProviderOption {
  id: string;
  name: string;
  provider: string;
  isDefault: boolean;
}

export interface RoutingPreviewResult {
  providerId: string;
  providerName: string;
  reason: string;
}

/**
 * Get active providers for the company (for dropdown selection).
 */
export async function getProvidersForProposal(
  companyId: string,
): Promise<ProviderOption[]> {
  await requireCompanyAccess(companyId);

  const providers = await prisma.paymentProvider.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, provider: true, isDefault: true },
  });

  return providers;
}

/**
 * Preview which provider would be used for automatic routing.
 * Bug #7 fix: caller should pass the per-installment value, NOT the total.
 */
export async function previewRoutingForProposal(
  companyId: string,
  clientType: string,
  value: number,
): Promise<RoutingPreviewResult | null> {
  await requireCompanyAccess(companyId);

  const routingType = clientType === "PJ" ? "PJ" : "PF";
  const result = await previewRouting(companyId, {
    clientType: routingType as "PF" | "PJ",
    value,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Payment Provider Resolution Helper
// ---------------------------------------------------------------------------

/**
 * Resolves the payment gateway for boleto generation.
 *
 * Flow:
 * 1. If providerId is given → getProviderById (manual override, must be active)
 * 2. If not → resolveProvider with routing rules
 * 3. If no providers configured → fallback to mock with console.warn
 *
 * Bug #6 fix: Only fall back to mock when no providers exist.
 *             Propagate decrypt/factory errors instead of swallowing them.
 * Bug #18 fix: getProviderById already filters isActive=true; explicit check added.
 */
async function resolveGatewayForBoleto(
  companyId: string,
  clientType: "PF" | "PJ",
  value: number,
  providerId?: string | null,
): Promise<{
  gateway: PaymentGateway;
  providerId: string | null;
  manualOverride: boolean;
  providerName: string;
}> {
  // Manual override: specific provider requested
  if (providerId) {
    // Bug #18: getProviderById already checks isActive=true and throws if not found/inactive
    const provider = await getProviderById(companyId, providerId);
    if (!provider.isActive) {
      throw new Error(`Provider "${provider.name}" está inativo e não pode ser usado.`);
    }
    const decryptedCredentials = JSON.parse(decrypt(provider.credentials)) as Record<string, unknown>;
    const metadata = provider.metadata as Record<string, unknown> | null;
    const gateway = getGateway(
      provider.provider,
      decryptedCredentials,
      metadata,
      provider.webhookSecret ?? undefined,
    );
    return {
      gateway,
      providerId: provider.id,
      manualOverride: true,
      providerName: provider.name,
    };
  }

  // Automatic routing
  // Bug #6: Check if ANY providers exist first. Only mock when truly none configured.
  const providerCount = await prisma.paymentProvider.count({
    where: { companyId, isActive: true },
  });

  if (providerCount === 0) {
    // No providers configured — fallback to mock
    console.warn(
      `[Payment] Nenhum provider configurado para empresa ${companyId}. Usando mock como fallback.`,
    );
    const gateway = getGateway("mock", {});
    return {
      gateway,
      providerId: null,
      manualOverride: false,
      providerName: "Mock (fallback)",
    };
  }

  // Providers exist — errors should propagate, NOT fall back to mock
  const provider = await resolveProvider(companyId, { clientType, value });
  const decryptedCredentials = JSON.parse(decrypt(provider.credentials)) as Record<string, unknown>;
  const metadata = provider.metadata as Record<string, unknown> | null;
  const gateway = getGateway(
    provider.provider,
    decryptedCredentials,
    metadata,
    provider.webhookSecret ?? undefined,
  );
  return {
    gateway,
    providerId: provider.id,
    manualOverride: false,
    providerName: provider.name,
  };
}

// ---------------------------------------------------------------------------
// Boleto Server Actions
// ---------------------------------------------------------------------------

export async function generateBoletosForProposal(
  input: GenerateBoletosInput
): Promise<{ boletos: BoletoRow[]; error?: string }> {
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

  // Bug #10: Move duplicate check inside transaction with advisory lock
  const proposal = await prisma.$transaction(async (tx) => {
    // Advisory lock on proposalId to prevent race condition (double-click)
    await tx.$queryRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      input.proposalId,
    );

    const p = await tx.proposal.findFirst({
      where: { id: input.proposalId, companyId: input.companyId },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            cpfCnpj: true,
            email: true,
            endereco: true,
            type: true,
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

    if (!p) {
      throw new Error("Proposta não encontrada");
    }
    if (p.status !== "ACCEPTED") {
      throw new Error(
        "Boletos só podem ser gerados para propostas aceitas. " +
          `Status atual: ${p.status}.`
      );
    }
    if (p.boletos.length > 0) {
      throw new Error("Esta proposta já possui boletos gerados");
    }

    return p;
  });

  const totalValue = Number(proposal.totalValue);
  const installmentValue = Math.round((totalValue / input.installments) * 100) / 100;
  const firstDue = new Date(input.firstDueDate);

  // Resolve payment gateway once (same provider for all installments)
  // Bug #7: Use installmentValue for routing (same as generation)
  const clientType = proposal.client.type as "PF" | "PJ";
  const { gateway, providerId, manualOverride, providerName } =
    await resolveGatewayForBoleto(
      input.companyId,
      clientType,
      installmentValue,
      input.providerId,
    );

  const createdBoletos: BoletoRow[] = [];
  const createdGatewayIds: string[] = []; // Bug #1: track for compensation
  let failedAtInstallment: number | null = null;
  let failureError: string | null = null;

  // Bug #1: Process each installment — gateway call OUTSIDE transaction,
  // then persist boleto+receivable atomically in DB.
  for (let i = 1; i <= input.installments; i++) {
    // Bug #5: Safe month addition with clamping
    const dueDate = addMonthsSafe(firstDue, i - 1);

    // Adjust last installment to handle rounding
    const value =
      i === input.installments
        ? Math.round((totalValue - installmentValue * (input.installments - 1)) * 100) / 100
        : installmentValue;

    // Build CreateBoletoInput for the new payment system
    const documentType = clientType === "PF" ? "cpf" : "cnpj";
    const boletoInput: CreateBoletoInput = {
      customer: {
        name: proposal.client.name,
        document: proposal.client.cpfCnpj,
        documentType,
        email: proposal.client.email ?? undefined,
      },
      amount: Math.round(value * 100), // Convert R$ to centavos
      dueDate,
      installmentNumber: i,
      totalInstallments: input.installments,
      description: `Parcela ${i}/${input.installments} - Proposta #${input.proposalId.slice(-6)}`,
      metadata: {
        proposalId: input.proposalId,
        companyRazaoSocial: proposal.company.razaoSocial,
        companyCnpj: proposal.company.cnpj,
      },
    };

    // Phase 1: Call external gateway FIRST (outside any transaction)
    let result: CreateBoletoResult;
    try {
      result = await gateway.createBoleto(boletoInput);
    } catch (err) {
      failedAtInstallment = i;
      failureError =
        err instanceof Error ? err.message : "Erro desconhecido no gateway";

      // Bug #1: Compensate — cancel previously created boletos at the gateway
      for (const gid of createdGatewayIds) {
        try {
          await gateway.cancelBoleto(gid);
          console.log(`[Payment] Compensação: boleto ${gid} cancelado no gateway`);
        } catch (cancelErr) {
          console.error(`[Payment] Falha ao cancelar boleto órfão ${gid}:`, cancelErr);
        }
      }

      // Bug B fix: Also clean up DB records (Boleto + AccountReceivable) for compensated boletos
      if (createdBoletos.length > 0) {
        const compensatedBoletoIds = createdBoletos.map(b => b.id);
        try {
          await prisma.$transaction(async (tx) => {
            // Mark AccountReceivables as CANCELLED
            await tx.accountReceivable.updateMany({
              where: { boletoId: { in: compensatedBoletoIds } },
              data: { status: "CANCELLED" },
            });
            // Mark Boletos as CANCELLED
            await tx.boleto.updateMany({
              where: { id: { in: compensatedBoletoIds } },
              data: { status: "CANCELLED" },
            });
          });
          console.log(`[Payment] Compensação DB: ${compensatedBoletoIds.length} boleto(s) e receivables marcados como CANCELLED`);
        } catch (dbErr) {
          console.error("[Payment] Falha ao compensar registros no DB:", dbErr);
        }
        // Clear createdBoletos to avoid returning phantom boletos
        createdBoletos.length = 0;
      }
      break;
    }

    createdGatewayIds.push(result.gatewayId);

    // Phase 2: Gateway succeeded — persist boleto + receivable atomically in DB
    const gatewayData = {
      url: result.url ?? null,
      line: result.line ?? null,
      barcode: result.barcode ?? null,
      qrCode: result.qrCode ?? null,
      pdf: result.pdf ?? null,
      nossoNumero: result.nossoNumero ?? null,
    };

    // Bug #1: Wrap DB writes in a mini-transaction for atomicity
    const boleto = await prisma.$transaction(async (tx) => {
      const b = await tx.boleto.create({
        data: {
          proposalId: input.proposalId,
          bankReference: result.gatewayId,
          providerId,
          gatewayId: result.gatewayId,
          gatewayData: gatewayData as unknown as Prisma.InputJsonValue,
          manualOverride,
          value: new Prisma.Decimal(value),
          dueDate,
          installmentNumber: i,
          status: "GENERATED",
          companyId: input.companyId,
        },
      });

      // Bug #4: Link receivable to boleto via FK
      await tx.accountReceivable.create({
        data: {
          clientId: proposal.clientId,
          description: `Boleto ${i}/${input.installments} - Proposta #${proposal.id.slice(-6)}`,
          value: new Prisma.Decimal(value),
          dueDate,
          status: "PENDING",
          companyId: input.companyId,
          boletoId: b.id,
        },
      });

      return b;
    });

    createdBoletos.push({
      id: boleto.id,
      bankReference: boleto.bankReference,
      value: boleto.value.toString(),
      dueDate: boleto.dueDate.toISOString(),
      installmentNumber: boleto.installmentNumber,
      status: boleto.status,
      createdAt: boleto.createdAt.toISOString(),
      providerName,
      manualOverride,
      gatewayData,
    });
  }

  // Build audit/event messages reflecting partial success if applicable
  const isPartial = failedAtInstallment !== null && createdBoletos.length > 0;
  const isFullFailure = failedAtInstallment !== null && createdBoletos.length === 0;

  if (isFullFailure) {
    throw new Error(
      `Falha ao gerar boleto da parcela ${failedAtInstallment}/${input.installments}: ${failureError}`
    );
  }

  const auditSuffix = isPartial
    ? ` (parcial: falha na parcela ${failedAtInstallment})`
    : "";

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
      providerName,
      manualOverride,
      ...(isPartial
        ? {
            partialFailure: true,
            failedAtInstallment,
            failureError,
          }
        : {}),
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  const eventMessage = isPartial
    ? `${createdBoletos.length}/${input.installments} boleto(s) gerado(s) via ${providerName}. Falha na parcela ${failedAtInstallment}: ${failureError}.`
    : `${createdBoletos.length} boleto(s) gerado(s) no valor total de R$ ${totalValue.toFixed(2)} via ${providerName}.`;

  await createProposalEvent(
    input.proposalId,
    isPartial ? "BOLETO_PARTIAL" : "BOLETO_GENERATED",
    eventMessage + auditSuffix,
    session.userId
  );

  return {
    boletos: createdBoletos,
    ...(isPartial
      ? {
          error: `Parcela ${failedAtInstallment}/${input.installments} falhou: ${failureError}. ${createdBoletos.length} boleto(s) gerado(s) com sucesso.`,
        }
      : {}),
  };
}

export async function listBoletosForProposal(
  proposalId: string,
  companyId: string
): Promise<BoletoRow[]> {
  await requireCompanyAccess(companyId);

  const boletos = await prisma.boleto.findMany({
    where: { proposalId, companyId },
    orderBy: { installmentNumber: "asc" },
    include: {
      provider: {
        select: { name: true },
      },
    },
  });

  return boletos.map((b) => ({
    id: b.id,
    bankReference: b.bankReference,
    value: b.value.toString(),
    dueDate: b.dueDate.toISOString(),
    installmentNumber: b.installmentNumber,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    providerName: b.provider?.name ?? null,
    manualOverride: b.manualOverride,
    gatewayData: b.gatewayData as BoletoRow["gatewayData"],
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

  // Registrar evento de log na proposta
  if (newStatus === "PAID") {
    await createProposalEvent(
      boleto.proposalId,
      "PAID",
      `Boleto #${boleto.installmentNumber} marcado como pago (R$ ${boleto.value}).`,
      session.userId
    );
  } else if (newStatus === "SENT") {
    await createProposalEvent(
      boleto.proposalId,
      "BOLETO_SENT",
      `Boleto #${boleto.installmentNumber} marcado como enviado.`,
      session.userId
    );
  }

  // Auto-emit NFS-e when boleto is paid
  if (newStatus === "PAID") {
    try {
      const fiscalConfig = await getCachedFiscalConfig(companyId);
      if (fiscalConfig.autoEmitNfse) {
        await emitInvoiceForBoleto(boletoId, companyId);
      }
    } catch (err) {
      // If auto-emit fails, create PENDING invoice for manual resolution
      console.error("Auto-emit NFS-e failed:", err);
      try {
        const boletoData = await prisma.boleto.findFirst({
          where: { id: boletoId, companyId },
          include: {
            proposal: {
              include: {
                client: { select: { id: true } },
                items: { select: { description: true } },
              },
            },
          },
        });
        if (boletoData) {
          const existingInvoice = await prisma.invoice.findFirst({
            where: { boletoId, companyId },
          });
          if (!existingInvoice) {
            await prisma.invoice.create({
              data: {
                proposalId: boletoData.proposal.id,
                boletoId,
                clientId: boletoData.proposal.client.id,
                serviceDescription: boletoData.proposal.items
                  .map((i) => i.description)
                  .join("; "),
                value: boletoData.value,
                issRate: 0,
                status: "PENDING",
                companyId,
              },
            });
          }
        }
      } catch (fallbackErr) {
        console.error("Failed to create PENDING invoice:", fallbackErr);
      }
    }
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Proposal Events
// ---------------------------------------------------------------------------

export interface ProposalEventRow {
  id: string;
  type: string;
  description: string;
  userId: string | null;
  createdAt: string;
}

export async function listProposalEvents(
  proposalId: string,
  companyId: string
): Promise<ProposalEventRow[]> {
  await requireCompanyAccess(companyId);

  const events = await prisma.proposalEvent.findMany({
    where: { proposalId, proposal: { companyId } },
    orderBy: { createdAt: "asc" },
  });

  return events.map((e) => ({
    id: e.id,
    type: e.type,
    description: e.description,
    userId: e.userId,
    createdAt: e.createdAt.toISOString(),
  }));
}
