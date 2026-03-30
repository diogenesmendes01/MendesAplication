"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { withLogging } from "@/lib/with-logging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DREPeriodType = "monthly" | "quarterly" | "annual";

export interface DREParams {
  companyId?: string; // undefined for consolidated view (admin only)
  periodType: DREPeriodType;
  year: number;
  period?: number; // month (1-12) or quarter (1-4), ignored for annual
}

export interface DREExpenseCategory {
  category: string;
  value: number;
}

export interface DREData {
  companyName: string | null;
  companyId: string | null;
  periodLabel: string;
  grossRevenue: number;
  deductions: number;
  netRevenue: number;
  costOfServices: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingResult: number;
  expensesByCategory: DREExpenseCategory[];
}

export interface DREPerCompany {
  companyId: string;
  companyName: string;
  grossRevenue: number;
  deductions: number;
  netRevenue: number;
  costOfServices: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingResult: number;
}

export interface DREConsolidatedReport {
  periodLabel: string;
  consolidated: DREData;
  perCompany: DREPerCompany[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDateRange(
  periodType: DREPeriodType,
  year: number,
  period?: number
): { dateFrom: Date; dateTo: Date } {
  switch (periodType) {
    case "monthly": {
      const month = (period ?? 1) - 1; // 0-indexed
      const dateFrom = new Date(year, month, 1);
      const dateTo = new Date(year, month + 1, 0, 23, 59, 59, 999);
      return { dateFrom, dateTo };
    }
    case "quarterly": {
      const quarter = (period ?? 1) - 1; // 0-indexed
      const startMonth = quarter * 3;
      const dateFrom = new Date(year, startMonth, 1);
      const dateTo = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
      return { dateFrom, dateTo };
    }
    case "annual": {
      const dateFrom = new Date(year, 0, 1);
      const dateTo = new Date(year, 11, 31, 23, 59, 59, 999);
      return { dateFrom, dateTo };
    }
  }
}

function getPeriodLabel(
  periodType: DREPeriodType,
  year: number,
  period?: number
): string {
  const monthNames = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

  switch (periodType) {
    case "monthly":
      return `${monthNames[(period ?? 1) - 1]} de ${year}`;
    case "quarterly":
      return `${period ?? 1}º Trimestre de ${year}`;
    case "annual":
      return `Ano ${year}`;
  }
}

async function computeDREForCompany(
  companyId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<{
  grossRevenue: number;
  operatingExpenses: number;
  expensesByCategory: DREExpenseCategory[];
}> {
  // Gross revenue: sum of PAID receivables in the period
  const paidReceivables = await prisma.accountReceivable.findMany({
    where: {
      companyId,
      status: "PAID",
      paidAt: { gte: dateFrom, lte: dateTo },
    },
    select: { value: true },
  });

  const grossRevenue = paidReceivables.reduce(
    (sum, r) => sum + Number(r.value),
    0
  );

  // Operating expenses: sum of PAID payables in the period, grouped by category
  const paidPayables = await prisma.accountPayable.findMany({
    where: {
      companyId,
      status: "PAID",
      paidAt: { gte: dateFrom, lte: dateTo },
    },
    select: {
      value: true,
      category: { select: { name: true } },
    },
  });

  const categoryMap = new Map<string, number>();
  let totalExpenses = 0;

  for (const p of paidPayables) {
    const categoryName = p.category?.name ?? "Sem Categoria";
    const value = Number(p.value);
    categoryMap.set(categoryName, (categoryMap.get(categoryName) ?? 0) + value);
    totalExpenses += value;
  }

  const expensesByCategory = Array.from(categoryMap.entries())
    .map(([category, value]) => ({
      category,
      value: Math.round(value * 100) / 100,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    operatingExpenses: Math.round(totalExpenses * 100) / 100,
    expensesByCategory,
  };
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

async function _getDREData(params: DREParams): Promise<DREData> {
  // Auth check
  if (params.companyId) {
    await requireCompanyAccess(params.companyId);
  } else {
    await requireSession();
  }

  const { dateFrom, dateTo } = getDateRange(
    params.periodType,
    params.year,
    params.period
  );
  const periodLabel = getPeriodLabel(
    params.periodType,
    params.year,
    params.period
  );

  const companyFilter = params.companyId
    ? { companyId: params.companyId }
    : {};

  // Gross revenue: sum of PAID receivables in the period
  const paidReceivables = await prisma.accountReceivable.findMany({
    where: {
      ...companyFilter,
      status: "PAID",
      paidAt: { gte: dateFrom, lte: dateTo },
    },
    select: { value: true },
  });

  const grossRevenue = paidReceivables.reduce(
    (sum, r) => sum + Number(r.value),
    0
  );

  // Operating expenses: sum of PAID payables in the period, grouped by category
  const paidPayables = await prisma.accountPayable.findMany({
    where: {
      ...companyFilter,
      status: "PAID",
      paidAt: { gte: dateFrom, lte: dateTo },
    },
    select: {
      value: true,
      category: { select: { name: true } },
    },
  });

  const categoryMap = new Map<string, number>();
  let totalExpenses = 0;

  for (const p of paidPayables) {
    const categoryName = p.category?.name ?? "Sem Categoria";
    const value = Number(p.value);
    categoryMap.set(categoryName, (categoryMap.get(categoryName) ?? 0) + value);
    totalExpenses += value;
  }

  const expensesByCategory = Array.from(categoryMap.entries())
    .map(([category, value]) => ({
      category,
      value: Math.round(value * 100) / 100,
    }))
    .sort((a, b) => b.value - a.value);

  // DRE structure
  const deductions = 0; // Placeholder until fiscal module (US-042+)
  const costOfServices = 0; // Placeholder until cost tracking
  const netRevenue = grossRevenue - deductions;
  const grossProfit = netRevenue - costOfServices;
  const operatingResult = grossProfit - totalExpenses;

  // Company name
  let companyName: string | null = null;
  if (params.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: params.companyId },
      select: { nomeFantasia: true },
    });
    companyName = company?.nomeFantasia ?? null;
  }

  return {
    companyName,
    companyId: params.companyId ?? null,
    periodLabel,
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    deductions: Math.round(deductions * 100) / 100,
    netRevenue: Math.round(netRevenue * 100) / 100,
    costOfServices: Math.round(costOfServices * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    operatingExpenses: Math.round(totalExpenses * 100) / 100,
    operatingResult: Math.round(operatingResult * 100) / 100,
    expensesByCategory,
  };
}

async function _getDREConsolidated(
  params: Omit<DREParams, "companyId">
): Promise<DREConsolidatedReport> {
  const session = await requireSession();

  const { dateFrom, dateTo } = getDateRange(
    params.periodType,
    params.year,
    params.period
  );
  const periodLabel = getPeriodLabel(
    params.periodType,
    params.year,
    params.period
  );

  // Get companies based on role
  let companies: { id: string; nomeFantasia: string }[];
  if (session.role === "ADMIN") {
    companies = await prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, nomeFantasia: true },
      orderBy: { nomeFantasia: "asc" },
    });
  } else {
    const assignments = await prisma.userCompany.findMany({
      where: { userId: session.userId },
      include: {
        company: { select: { id: true, nomeFantasia: true } },
      },
    });
    companies = assignments
      .map((a) => a.company)
      .filter(Boolean)
      .sort((a, b) => a.nomeFantasia.localeCompare(b.nomeFantasia));
  }

  // Compute DRE for each company
  const perCompany: DREPerCompany[] = [];
  let totalGrossRevenue = 0;
  let totalOperatingExpenses = 0;

  for (const company of companies) {
    const result = await computeDREForCompany(company.id, dateFrom, dateTo);
    const deductions = 0;
    const costOfServices = 0;
    const netRevenue = result.grossRevenue - deductions;
    const grossProfit = netRevenue - costOfServices;
    const operatingResult = grossProfit - result.operatingExpenses;

    totalGrossRevenue += result.grossRevenue;
    totalOperatingExpenses += result.operatingExpenses;

    perCompany.push({
      companyId: company.id,
      companyName: company.nomeFantasia,
      grossRevenue: Math.round(result.grossRevenue * 100) / 100,
      deductions: Math.round(deductions * 100) / 100,
      netRevenue: Math.round(netRevenue * 100) / 100,
      costOfServices: Math.round(costOfServices * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      operatingExpenses: Math.round(result.operatingExpenses * 100) / 100,
      operatingResult: Math.round(operatingResult * 100) / 100,
    });
  }

  // Consolidated totals
  const deductions = 0;
  const costOfServices = 0;
  const netRevenue = totalGrossRevenue - deductions;
  const grossProfit = netRevenue - costOfServices;
  const operatingResult = grossProfit - totalOperatingExpenses;

  // Consolidated expense categories
  const paidPayables = await prisma.accountPayable.findMany({
    where: {
      status: "PAID",
      paidAt: { gte: dateFrom, lte: dateTo },
    },
    select: {
      value: true,
      category: { select: { name: true } },
    },
  });

  const categoryMap = new Map<string, number>();
  for (const p of paidPayables) {
    const categoryName = p.category?.name ?? "Sem Categoria";
    const value = Number(p.value);
    categoryMap.set(categoryName, (categoryMap.get(categoryName) ?? 0) + value);
  }

  const expensesByCategory = Array.from(categoryMap.entries())
    .map(([category, value]) => ({
      category,
      value: Math.round(value * 100) / 100,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    periodLabel,
    consolidated: {
      companyName: null,
      companyId: null,
      periodLabel,
      grossRevenue: Math.round(totalGrossRevenue * 100) / 100,
      deductions: Math.round(deductions * 100) / 100,
      netRevenue: Math.round(netRevenue * 100) / 100,
      costOfServices: Math.round(costOfServices * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      operatingExpenses: Math.round(totalOperatingExpenses * 100) / 100,
      operatingResult: Math.round(operatingResult * 100) / 100,
      expensesByCategory,
    },
    perCompany,
  };
}

async function _getCompaniesForDRE() {
  const session = await requireSession();

  if (session.role === "ADMIN") {
    return prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, nomeFantasia: true },
      orderBy: { nomeFantasia: "asc" },
    });
  }

  const assignments = await prisma.userCompany.findMany({
    where: { userId: session.userId },
    include: {
      company: { select: { id: true, nomeFantasia: true } },
    },
  });

  return assignments
    .map((a) => a.company)
    .filter(Boolean)
    .sort((a, b) => a.nomeFantasia.localeCompare(b.nomeFantasia));
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
export const getDREData = withLogging('dre.getDREData', _getDREData);
export const getDREConsolidated = withLogging('dre.getDREConsolidated', _getDREConsolidated);
export const getCompaniesForDRE = withLogging('dre.getCompaniesForDRE', _getCompaniesForDRE);
