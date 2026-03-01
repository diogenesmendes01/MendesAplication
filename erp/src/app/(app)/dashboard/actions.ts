"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PeriodType = "day" | "week" | "month" | "year" | "custom";

export interface DashboardFilters {
  period: PeriodType;
  customStart?: string; // ISO date string
  customEnd?: string;   // ISO date string
}

export interface CompanyKPI {
  companyId: string;
  companyName: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface BoletoSummary {
  emitted: number;
  paid: number;
  overdue: number;
}

export interface RevenueChartEntry {
  companyName: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface DashboardData {
  totalRevenue: number;
  totalExpenses: number;
  totalProfit: number;
  companies: CompanyKPI[];
  revenueChart: RevenueChartEntry[];
  boletoSummary: BoletoSummary;
  periodLabel: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPeriodLabel(period: PeriodType, customStart?: string, customEnd?: string): string {
  const now = new Date();
  switch (period) {
    case "day":
      return now.toLocaleDateString("pt-BR");
    case "week": {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      return `${weekStart.toLocaleDateString("pt-BR")} - ${weekEnd.toLocaleDateString("pt-BR")}`;
    }
    case "month":
      return now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    case "year":
      return now.getFullYear().toString();
    case "custom":
      if (customStart && customEnd) {
        return `${new Date(customStart).toLocaleDateString("pt-BR")} - ${new Date(customEnd).toLocaleDateString("pt-BR")}`;
      }
      return "Período personalizado";
  }
}

/**
 * Generate deterministic placeholder KPI data for a company.
 * Uses a simple hash of companyId to create varied but stable numbers.
 */
function generatePlaceholderKPI(companyId: string, companyName: string, period: PeriodType): CompanyKPI {
  // Simple hash for deterministic but varied data
  let hash = 0;
  for (let i = 0; i < companyId.length; i++) {
    hash = ((hash << 5) - hash + companyId.charCodeAt(i)) | 0;
  }
  const seed = Math.abs(hash);

  // Scale factor based on period
  const scale: Record<PeriodType, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
    custom: 30,
  };

  const factor = scale[period];
  const baseRevenue = ((seed % 50) + 10) * 1000; // 10k-60k per day
  const baseExpenses = ((seed % 30) + 5) * 1000;  // 5k-35k per day

  const revenue = baseRevenue * factor;
  const expenses = baseExpenses * factor;
  const profit = revenue - expenses;

  return {
    companyId,
    companyName,
    revenue,
    expenses,
    profit,
  };
}

/**
 * Generate placeholder boleto summary data.
 * Uses period-based scaling for consistent placeholder numbers.
 */
function generatePlaceholderBoletoSummary(period: PeriodType): BoletoSummary {
  const scale: Record<PeriodType, number> = {
    day: 1,
    week: 5,
    month: 20,
    year: 240,
    custom: 20,
  };
  const factor = scale[period];
  return {
    emitted: Math.round(3 * factor),
    paid: Math.round(2 * factor),
    overdue: Math.round(0.5 * factor),
  };
}

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function getDashboardData(filters: DashboardFilters): Promise<DashboardData> {
  const session = await requireSession();

  // Get companies based on role
  let companies: { id: string; nomeFantasia: string }[];

  if (session.role === "ADMIN") {
    companies = await prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, nomeFantasia: true },
      orderBy: { nomeFantasia: "asc" },
    });
  } else {
    // Manager: only assigned companies
    const assignments = await prisma.userCompany.findMany({
      where: { userId: session.userId },
      include: {
        company: {
          select: { id: true, nomeFantasia: true, status: true },
        },
      },
    });
    companies = assignments
      .filter((a) => a.company.status === "ACTIVE")
      .map((a) => ({ id: a.company.id, nomeFantasia: a.company.nomeFantasia }));
  }

  // Generate placeholder KPI data for each company
  const companyKPIs = companies.map((c) =>
    generatePlaceholderKPI(c.id, c.nomeFantasia, filters.period)
  );

  // Aggregate totals
  const totalRevenue = companyKPIs.reduce((sum, c) => sum + c.revenue, 0);
  const totalExpenses = companyKPIs.reduce((sum, c) => sum + c.expenses, 0);
  const totalProfit = totalRevenue - totalExpenses;

  // Chart data: revenue comparison across companies
  const revenueChart: RevenueChartEntry[] = companyKPIs.map((c) => ({
    companyName: c.companyName,
    revenue: c.revenue,
    expenses: c.expenses,
    profit: c.profit,
  }));

  // Boleto summary: placeholder data until CRM module
  const boletoSummary = generatePlaceholderBoletoSummary(filters.period);

  return {
    totalRevenue,
    totalExpenses,
    totalProfit,
    companies: companyKPIs,
    revenueChart,
    boletoSummary,
    periodLabel: getPeriodLabel(filters.period, filters.customStart, filters.customEnd),
  };
}
