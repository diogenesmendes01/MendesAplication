"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireSession } from "@/lib/session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PeriodGrouping = "daily" | "weekly" | "monthly";
export type ViewMode = "company" | "consolidated";

export interface CashFlowParams {
  companyId?: string; // null for consolidated view (admin only)
  grouping: PeriodGrouping;
  dateFrom: string;
  dateTo: string;
}

export interface CashFlowEntry {
  period: string; // label for the period
  income: number;
  expenses: number;
  net: number;
}

export interface CashFlowSummary {
  currentBalance: number;
  projectedBalance: number;
  totalIncome: number;
  totalExpenses: number;
  entries: CashFlowEntry[];
  companyName: string | null; // null for consolidated
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWeekLabel(date: Date): string {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor(
    (date.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)
  );
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `Sem ${weekNumber}/${date.getFullYear()}`;
}

function getMonthLabel(date: Date): string {
  const months = [
    "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
    "Jul", "Ago", "Set", "Out", "Nov", "Dez",
  ];
  return `${months[date.getMonth()]}/${date.getFullYear()}`;
}

function getDayLabel(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function getPeriodKey(date: Date, grouping: PeriodGrouping): string {
  switch (grouping) {
    case "daily":
      return date.toISOString().slice(0, 10); // YYYY-MM-DD for sorting
    case "weekly": {
      // Start of ISO week (Monday)
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      return d.toISOString().slice(0, 10);
    }
    case "monthly":
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
}

function getPeriodLabel(key: string, grouping: PeriodGrouping): string {
  switch (grouping) {
    case "daily": {
      const d = new Date(key + "T00:00:00");
      return getDayLabel(d);
    }
    case "weekly": {
      const d = new Date(key + "T00:00:00");
      return getWeekLabel(d);
    }
    case "monthly": {
      const [year, month] = key.split("-");
      const d = new Date(parseInt(year), parseInt(month) - 1, 1);
      return getMonthLabel(d);
    }
  }
}

function generateAllPeriodKeys(
  from: Date,
  to: Date,
  grouping: PeriodGrouping
): string[] {
  const keys = new Set<string>();
  const current = new Date(from);
  while (current <= to) {
    keys.add(getPeriodKey(current, grouping));
    current.setDate(current.getDate() + 1);
  }
  const sorted = Array.from(keys).sort();
  return sorted;
}

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function getCashFlowData(
  params: CashFlowParams
): Promise<CashFlowSummary> {
  // Auth check
  if (params.companyId) {
    await requireCompanyAccess(params.companyId);
  } else {
    // Consolidated view: require authenticated session (admin sees all)
    await requireSession();
  }

  const dateFrom = new Date(params.dateFrom);
  const dateTo = new Date(params.dateTo);
  dateTo.setHours(23, 59, 59, 999);

  const companyFilter = params.companyId ? { companyId: params.companyId } : {};

  // Fetch receivables (income) — PAID items with paidAt in range, plus PENDING for projection
  const [paidReceivables, pendingReceivables] = await Promise.all([
    prisma.accountReceivable.findMany({
      where: {
        ...companyFilter,
        status: "PAID",
        paidAt: { gte: dateFrom, lte: dateTo },
      },
      select: { value: true, paidAt: true },
    }),
    prisma.accountReceivable.findMany({
      where: {
        ...companyFilter,
        status: "PENDING",
        dueDate: { gte: dateFrom, lte: dateTo },
      },
      select: { value: true, dueDate: true },
    }),
  ]);

  // Fetch payables (expenses) — PAID items with paidAt in range, plus PENDING for projection
  const [paidPayables, pendingPayables] = await Promise.all([
    prisma.accountPayable.findMany({
      where: {
        ...companyFilter,
        status: "PAID",
        paidAt: { gte: dateFrom, lte: dateTo },
      },
      select: { value: true, paidAt: true },
    }),
    prisma.accountPayable.findMany({
      where: {
        ...companyFilter,
        OR: [
          { status: "PENDING" },
          { status: "OVERDUE" },
        ],
        dueDate: { gte: dateFrom, lte: dateTo },
      },
      select: { value: true, dueDate: true },
    }),
  ]);

  // Build period buckets
  const allKeys = generateAllPeriodKeys(dateFrom, dateTo, params.grouping);
  const incomeMap = new Map<string, number>();
  const expenseMap = new Map<string, number>();

  // Initialize all periods
  for (const key of allKeys) {
    incomeMap.set(key, 0);
    expenseMap.set(key, 0);
  }

  // Aggregate paid receivables (realized income)
  for (const r of paidReceivables) {
    if (!r.paidAt) continue;
    const key = getPeriodKey(r.paidAt, params.grouping);
    incomeMap.set(key, (incomeMap.get(key) ?? 0) + Number(r.value));
  }

  // Aggregate pending receivables (projected income)
  for (const r of pendingReceivables) {
    const key = getPeriodKey(r.dueDate, params.grouping);
    incomeMap.set(key, (incomeMap.get(key) ?? 0) + Number(r.value));
  }

  // Aggregate paid payables (realized expenses)
  for (const p of paidPayables) {
    if (!p.paidAt) continue;
    const key = getPeriodKey(p.paidAt, params.grouping);
    expenseMap.set(key, (expenseMap.get(key) ?? 0) + Number(p.value));
  }

  // Aggregate pending/overdue payables (projected expenses)
  for (const p of pendingPayables) {
    const key = getPeriodKey(p.dueDate, params.grouping);
    expenseMap.set(key, (expenseMap.get(key) ?? 0) + Number(p.value));
  }

  // Build entries
  let totalIncome = 0;
  let totalExpenses = 0;
  const entries: CashFlowEntry[] = allKeys.map((key) => {
    const income = incomeMap.get(key) ?? 0;
    const expenses = expenseMap.get(key) ?? 0;
    totalIncome += income;
    totalExpenses += expenses;
    return {
      period: getPeriodLabel(key, params.grouping),
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      net: Math.round((income - expenses) * 100) / 100,
    };
  });

  // Current balance: only realized (paid) items
  const realizedIncome = paidReceivables.reduce(
    (sum, r) => sum + Number(r.value),
    0
  );
  const realizedExpenses = paidPayables.reduce(
    (sum, p) => sum + Number(p.value),
    0
  );
  const currentBalance = Math.round((realizedIncome - realizedExpenses) * 100) / 100;

  // Projected balance: includes pending items
  const projectedIncome = pendingReceivables.reduce(
    (sum, r) => sum + Number(r.value),
    0
  );
  const projectedExpenses = pendingPayables.reduce(
    (sum, p) => sum + Number(p.value),
    0
  );
  const projectedBalance =
    Math.round(
      (currentBalance + projectedIncome - projectedExpenses) * 100
    ) / 100;

  // Get company name if specific company
  let companyName: string | null = null;
  if (params.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: params.companyId },
      select: { nomeFantasia: true },
    });
    companyName = company?.nomeFantasia ?? null;
  }

  return {
    currentBalance,
    projectedBalance,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    entries,
    companyName,
  };
}

export async function getCompaniesForCashFlow() {
  const session = await requireSession();

  if (session.role === "ADMIN") {
    return prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, nomeFantasia: true },
      orderBy: { nomeFantasia: "asc" },
    });
  }

  // Manager: only assigned companies
  const assignments = await prisma.userCompany.findMany({
    where: { userId: session.userId },
    include: {
      company: {
        select: { id: true, nomeFantasia: true },
      },
    },
  });

  return assignments
    .map((a) => a.company)
    .filter(Boolean)
    .sort((a, b) => a.nomeFantasia.localeCompare(b.nomeFantasia));
}
