"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { type TaxType, type TaxStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaxCalculation {
  type: TaxType;
  label: string;
  rate: number; // percentage
  baseValue: number; // sum of issued invoice values
  calculatedValue: number;
  description: string;
}

export interface CompanyTaxSummary {
  companyId: string;
  companyName: string;
  cnpj: string;
  totalInvoiceValue: number;
  taxes: TaxCalculation[];
  totalTaxes: number;
  pendingEntries: TaxEntryRow[];
}

export interface TaxEntryRow {
  id: string;
  type: TaxType;
  period: string;
  value: string;
  dueDate: string;
  status: TaxStatus;
  companyId: string;
  companyName: string;
}

export interface TaxDashboardData {
  companies: CompanyTaxSummary[];
  consolidated: {
    totalInvoiceValue: number;
    totalTaxes: number;
    taxBreakdown: TaxCalculation[];
  };
  upcomingEntries: TaxEntryRow[];
  overdueEntries: TaxEntryRow[];
}

// ---------------------------------------------------------------------------
// Tax rate constants (Simples Nacional / default rates)
// ---------------------------------------------------------------------------

const TAX_RATES: Record<TaxType, { label: string; rate: number; description: string }> = {
  ISS: { label: "ISS", rate: 5.0, description: "Imposto Sobre Serviços" },
  PIS: { label: "PIS", rate: 0.65, description: "Programa de Integração Social" },
  COFINS: { label: "COFINS", rate: 3.0, description: "Contribuição para Financiamento da Seguridade Social" },
  IRPJ: { label: "IRPJ", rate: 4.8, description: "Imposto de Renda Pessoa Jurídica" },
  CSLL: { label: "CSLL", rate: 2.88, description: "Contribuição Social sobre o Lucro Líquido" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function calculateTaxesFromInvoices(totalInvoiceValue: number): TaxCalculation[] {
  return (Object.keys(TAX_RATES) as TaxType[]).map((type) => {
    const info = TAX_RATES[type];
    const calculatedValue = totalInvoiceValue * (info.rate / 100);
    return {
      type,
      label: info.label,
      rate: info.rate,
      baseValue: totalInvoiceValue,
      calculatedValue: Math.round(calculatedValue * 100) / 100,
      description: info.description,
    };
  });
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Get the full tax dashboard data.
 * Admin sees all companies consolidated; Manager sees only their company.
 */
export async function getTaxDashboardData(): Promise<TaxDashboardData> {
  const session = await requireSession();
  const currentPeriod = getCurrentPeriod();

  // Get companies based on role
  let companies: { id: string; nomeFantasia: string; cnpj: string }[];

  if (session.role === "ADMIN") {
    companies = await prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, nomeFantasia: true, cnpj: true },
      orderBy: { nomeFantasia: "asc" },
      take: 500,
    });
  } else {
    const assignments = await prisma.userCompany.findMany({
      where: { userId: session.userId },
      include: {
        company: {
          select: { id: true, nomeFantasia: true, cnpj: true, status: true },
        },
      },
    });
    companies = assignments
      .filter((a) => a.company.status === "ACTIVE")
      .map((a) => ({
        id: a.company.id,
        nomeFantasia: a.company.nomeFantasia,
        cnpj: a.company.cnpj,
      }));
  }

  // For each company, get issued invoices for current period and calculate taxes
  const companySummaries: CompanyTaxSummary[] = [];

  for (const company of companies) {
    // Sum of issued invoices for current period
    const periodStart = new Date(`${currentPeriod}-01`);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const invoiceAgg = await prisma.invoice.aggregate({
      where: {
        companyId: company.id,
        status: "ISSUED",
        createdAt: {
          gte: periodStart,
          lt: periodEnd,
        },
      },
      _sum: { value: true },
    });

    const totalInvoiceValue = Number(invoiceAgg._sum.value ?? 0);
    const taxes = calculateTaxesFromInvoices(totalInvoiceValue);
    const totalTaxes = taxes.reduce((sum, t) => sum + t.calculatedValue, 0);

    // Get pending tax entries for this company
    const pendingEntries = await prisma.taxEntry.findMany({
      where: {
        companyId: company.id,
        status: "PENDING",
      },
      orderBy: { dueDate: "asc" },
      take: 500,
    });

    companySummaries.push({
      companyId: company.id,
      companyName: company.nomeFantasia,
      cnpj: company.cnpj,
      totalInvoiceValue,
      taxes,
      totalTaxes,
      pendingEntries: pendingEntries.map((e) => ({
        id: e.id,
        type: e.type,
        period: e.period,
        value: e.value.toString(),
        dueDate: e.dueDate.toISOString(),
        status: e.status,
        companyId: e.companyId,
        companyName: company.nomeFantasia,
      })),
    });
  }

  // Consolidated view
  const consolidatedTotal = companySummaries.reduce((sum, c) => sum + c.totalInvoiceValue, 0);
  const consolidatedTaxes = calculateTaxesFromInvoices(consolidatedTotal);
  const totalTaxes = consolidatedTaxes.reduce((sum, t) => sum + t.calculatedValue, 0);

  // Upcoming entries: due within 7 days
  const now = new Date();
  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const companyIds = companies.map((c) => c.id);
  const companyNameMap = new Map(companies.map((c) => [c.id, c.nomeFantasia]));

  const upcomingRaw = await prisma.taxEntry.findMany({
    where: {
      companyId: { in: companyIds },
      status: "PENDING",
      dueDate: {
        gte: now,
        lte: sevenDaysFromNow,
      },
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  const overdueRaw = await prisma.taxEntry.findMany({
    where: {
      companyId: { in: companyIds },
      status: "PENDING",
      dueDate: { lt: now },
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  const mapEntry = (e: typeof upcomingRaw[number]): TaxEntryRow => ({
    id: e.id,
    type: e.type,
    period: e.period,
    value: e.value.toString(),
    dueDate: e.dueDate.toISOString(),
    status: e.status,
    companyId: e.companyId,
    companyName: companyNameMap.get(e.companyId) ?? "",
  });

  return {
    companies: companySummaries,
    consolidated: {
      totalInvoiceValue: consolidatedTotal,
      totalTaxes,
      taxBreakdown: consolidatedTaxes,
    },
    upcomingEntries: upcomingRaw.map(mapEntry),
    overdueEntries: overdueRaw.map(mapEntry),
  };
}

/**
 * Create a tax entry manually (e.g., to register a tax obligation).
 */
export async function createTaxEntry(input: {
  companyId: string;
  type: TaxType;
  period: string;
  value: number;
  dueDate: string;
}) {
  const session = await requireCompanyAccess(input.companyId);

  const entry = await prisma.taxEntry.create({
    data: {
      companyId: input.companyId,
      type: input.type,
      period: input.period,
      value: new Decimal(input.value),
      dueDate: new Date(input.dueDate),
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "TaxEntry",
    entityId: entry.id,
    dataAfter: {
      type: input.type,
      period: input.period,
      value: input.value,
      dueDate: input.dueDate,
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  return { success: true, id: entry.id };
}

/**
 * Mark a tax entry as paid.
 */
export async function markTaxEntryAsPaid(entryId: string, companyId: string) {
  const session = await requireCompanyAccess(companyId);

  const entry = await prisma.taxEntry.findFirst({
    where: { id: entryId, companyId },
  });

  if (!entry) {
    throw new Error("Lançamento fiscal não encontrado");
  }

  if (entry.status === "PAID") {
    throw new Error("Este lançamento já foi pago");
  }

  await prisma.taxEntry.update({
    where: { id: entryId },
    data: { status: "PAID" },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "TaxEntry",
    entityId: entryId,
    dataBefore: { status: "PENDING" } as unknown as Prisma.InputJsonValue,
    dataAfter: { status: "PAID" } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { success: true };
}
