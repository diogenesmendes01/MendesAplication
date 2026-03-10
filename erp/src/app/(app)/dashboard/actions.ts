"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PeriodType = "day" | "week" | "month" | "year" | "custom";

export interface DashboardFilters {
  period: PeriodType;
  customStart?: string;
  customEnd?: string;
}

export interface KPIData {
  revenue: number;
  expenses: number;
  balance: number;
  openTickets: number;
  revenuePrevious: number;
  expensesPrevious: number;
  balancePrevious: number;
  openTicketsCritical: number;
}

export interface MonthlyChartEntry {
  month: string;
  monthShort: string;
  revenue: number;
  expenses: number;
}

export interface UpcomingPayable {
  id: string;
  supplier: string;
  description: string;
  value: number;
  dueDate: string;
  isOverdue: boolean;
  daysUntilDue: number;
}

export interface RecentProposal {
  id: string;
  clientName: string;
  proposalNumber: string;
  totalValue: number;
  status: string;
  createdAt: string;
}

export interface TicketWithSLA {
  id: string;
  subject: string;
  clientName: string;
  companyName: string;
  priority: string;
  slaStatus: "breached" | "at_risk" | "ok";
  createdAt: string;
  assigneeName: string | null;
  assigneeInitials: string;
}

export interface DashboardData {
  kpis: KPIData;
  monthlyChart: MonthlyChartEntry[];
  upcomingPayables: UpcomingPayable[];
  recentProposals: RecentProposal[];
  ticketsWithSLA: TicketWithSLA[];
  periodLabel: string;
}

export type AlertType =
  | "BOLETO_VENCIDO"
  | "SLA_BREACH"
  | "SLA_RISK"
  | "NFSE_FAILED"
  | "PROPOSTA_SEM_RESPOSTA";

export interface DashboardAlert {
  type: AlertType;
  title: string;
  description: string;
  href: string;
  severity: "critical" | "warning";
  count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDateRange(period: PeriodType, customStart?: string, customEnd?: string): { start: Date; end: Date } {
  const now = new Date();

  switch (period) {
    case "day": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    case "week": {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start, end };
    }
    case "year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear() + 1, 0, 1);
      return { start, end };
    }
    case "custom": {
      if (customStart && customEnd) {
        return {
          start: new Date(customStart + "T00:00:00"),
          end: new Date(customEnd + "T23:59:59"),
        };
      }
      // Fallback to month
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start: s, end: e };
    }
  }
}

function getPreviousDateRange(start: Date, end: Date): { start: Date; end: Date } {
  const durationMs = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - durationMs),
    end: new Date(start.getTime()),
  };
}

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

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Resolve accessible company IDs
// ---------------------------------------------------------------------------

async function resolveCompanyIds(session: { userId: string; role: string }): Promise<string[]> {
  if (session.role === "ADMIN") {
    const companies = await prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    return companies.map((c) => c.id);
  }

  const assignments = await prisma.userCompany.findMany({
    where: { userId: session.userId },
    include: { company: { select: { id: true, status: true } } },
  });
  return assignments
    .filter((a) => a.company.status === "ACTIVE")
    .map((a) => a.company.id);
}

// ---------------------------------------------------------------------------
// Server Action: getDashboardData
// ---------------------------------------------------------------------------

export async function getDashboardData(filters: DashboardFilters): Promise<DashboardData> {
  const session = await requireSession();
  const companyIds = await resolveCompanyIds(session);

  if (companyIds.length === 0) {
    return {
      kpis: {
        revenue: 0, expenses: 0, balance: 0, openTickets: 0,
        revenuePrevious: 0, expensesPrevious: 0, balancePrevious: 0, openTicketsCritical: 0,
      },
      monthlyChart: [],
      upcomingPayables: [],
      recentProposals: [],
      ticketsWithSLA: [],
      periodLabel: getPeriodLabel(filters.period, filters.customStart, filters.customEnd),
    };
  }

  const { start, end } = getDateRange(filters.period, filters.customStart, filters.customEnd);
  const prev = getPreviousDateRange(start, end);
  const now = new Date();

  // Run all queries in parallel
  const [
    revenueAgg,
    revenuePrevAgg,
    expensesAgg,
    expensesPrevAgg,
    openTicketsCount,
    criticalTicketsCount,
    monthlyRevenue,
    monthlyExpenses,
    upcomingPayables,
    recentProposals,
    ticketsWithSLAData,
  ] = await Promise.all([
    // Current period revenue (Accounts Receivable paid in period)
    prisma.accountReceivable.aggregate({
      where: {
        companyId: { in: companyIds },
        status: "PAID",
        paidAt: { gte: start, lt: end },
      },
      _sum: { value: true },
    }),

    // Previous period revenue
    prisma.accountReceivable.aggregate({
      where: {
        companyId: { in: companyIds },
        status: "PAID",
        paidAt: { gte: prev.start, lt: prev.end },
      },
      _sum: { value: true },
    }),

    // Current period expenses (Accounts Payable paid in period)
    prisma.accountPayable.aggregate({
      where: {
        companyId: { in: companyIds },
        status: "PAID",
        paidAt: { gte: start, lt: end },
      },
      _sum: { value: true },
    }),

    // Previous period expenses
    prisma.accountPayable.aggregate({
      where: {
        companyId: { in: companyIds },
        status: "PAID",
        paidAt: { gte: prev.start, lt: prev.end },
      },
      _sum: { value: true },
    }),

    // Open tickets count
    prisma.ticket.count({
      where: {
        companyId: { in: companyIds },
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
    }),

    // Critical tickets (SLA breached)
    prisma.ticket.count({
      where: {
        companyId: { in: companyIds },
        slaBreached: true,
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
    }),

    // Monthly revenue (last 6 months) — raw SQL for grouping by month
    prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
      SELECT date_trunc('month', "paidAt") AS month, SUM(value) AS total
      FROM accounts_receivable
      WHERE "companyId" = ANY(${companyIds})
        AND status = 'PAID'
        AND "paidAt" >= ${new Date(now.getFullYear(), now.getMonth() - 5, 1)}
        AND "paidAt" < ${new Date(now.getFullYear(), now.getMonth() + 1, 1)}
      GROUP BY date_trunc('month', "paidAt")
      ORDER BY month
    `,

    // Monthly expenses (last 6 months)
    prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
      SELECT date_trunc('month', "paidAt") AS month, SUM(value) AS total
      FROM accounts_payable
      WHERE "companyId" = ANY(${companyIds})
        AND status = 'PAID'
        AND "paidAt" >= ${new Date(now.getFullYear(), now.getMonth() - 5, 1)}
        AND "paidAt" < ${new Date(now.getFullYear(), now.getMonth() + 1, 1)}
      GROUP BY date_trunc('month', "paidAt")
      ORDER BY month
    `,

    // Upcoming payables (next 30 days + overdue)
    prisma.accountPayable.findMany({
      where: {
        companyId: { in: companyIds },
        status: { in: ["PENDING", "OVERDUE"] },
        dueDate: {
          lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30),
        },
      },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),

    // Recent proposals
    prisma.proposal.findMany({
      where: {
        companyId: { in: companyIds },
      },
      include: {
        client: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),

    // Tickets with SLA issues
    prisma.ticket.findMany({
      where: {
        companyId: { in: companyIds },
        status: { notIn: ["RESOLVED", "CLOSED"] },
        OR: [{ slaBreached: true }, { slaAtRisk: true }],
      },
      include: {
        client: { select: { name: true } },
        company: { select: { nomeFantasia: true } },
        assignee: { select: { name: true } },
      },
      orderBy: [{ slaBreached: "desc" }, { createdAt: "asc" }],
      take: 6,
    }),
  ]);

  // Build KPIs
  const revenue = Number(revenueAgg._sum.value ?? 0);
  const expenses = Number(expensesAgg._sum.value ?? 0);
  const revenuePrevious = Number(revenuePrevAgg._sum.value ?? 0);
  const expensesPrevious = Number(expensesPrevAgg._sum.value ?? 0);

  const kpis: KPIData = {
    revenue,
    expenses,
    balance: revenue - expenses,
    openTickets: openTicketsCount,
    revenuePrevious,
    expensesPrevious,
    balancePrevious: revenuePrevious - expensesPrevious,
    openTicketsCritical: criticalTicketsCount,
  };

  // Build monthly chart (last 6 months)
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const monthFullNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  const revenueByMonth = new Map<string, number>();
  for (const r of monthlyRevenue) {
    const d = new Date(r.month);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    revenueByMonth.set(key, Number(r.total));
  }

  const expensesByMonth = new Map<string, number>();
  for (const e of monthlyExpenses) {
    const d = new Date(e.month);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    expensesByMonth.set(key, Number(e.total));
  }

  const monthlyChart: MonthlyChartEntry[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    monthlyChart.push({
      month: monthFullNames[d.getMonth()],
      monthShort: monthNames[d.getMonth()],
      revenue: revenueByMonth.get(key) ?? 0,
      expenses: expensesByMonth.get(key) ?? 0,
    });
  }

  // Build upcoming payables
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const formattedPayables: UpcomingPayable[] = upcomingPayables.map((p) => {
    const dueDate = new Date(p.dueDate);
    const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const diffDays = Math.round((dueDateStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    return {
      id: p.id,
      supplier: p.supplier,
      description: p.description,
      value: Number(p.value),
      dueDate: p.dueDate.toISOString(),
      isOverdue: diffDays < 0,
      daysUntilDue: diffDays,
    };
  });

  // Build recent proposals
  const formattedProposals: RecentProposal[] = recentProposals.map((p) => ({
    id: p.id,
    clientName: p.client.name,
    proposalNumber: `#P-${p.id.slice(-4).toUpperCase()}`,
    totalValue: Number(p.totalValue),
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  }));

  // Build tickets with SLA
  const formattedTickets: TicketWithSLA[] = ticketsWithSLAData.map((t) => ({
    id: t.id,
    subject: t.subject,
    clientName: t.client.name,
    companyName: t.company.nomeFantasia,
    priority: t.priority,
    slaStatus: t.slaBreached ? "breached" as const : "at_risk" as const,
    createdAt: t.createdAt.toISOString(),
    assigneeName: t.assignee?.name ?? null,
    assigneeInitials: t.assignee ? getInitials(t.assignee.name) : "?",
  }));

  return {
    kpis,
    monthlyChart,
    upcomingPayables: formattedPayables,
    recentProposals: formattedProposals,
    ticketsWithSLA: formattedTickets,
    periodLabel: getPeriodLabel(filters.period, filters.customStart, filters.customEnd),
  };
}

// ---------------------------------------------------------------------------
// Dashboard Alerts
// ---------------------------------------------------------------------------

export async function getDashboardAlerts(): Promise<DashboardAlert[]> {
  const session = await requireSession();
  const companyIds = await resolveCompanyIds(session);

  if (companyIds.length === 0) return [];

  const alerts: DashboardAlert[] = [];
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Run all counts in parallel
  const [overdueCount, slaBreachedCount, slaAtRiskCount, pendingNfseCount, oldSentProposalsCount] =
    await Promise.all([
      // Boletos vencidos
      prisma.boleto.count({
        where: { companyId: { in: companyIds }, status: "OVERDUE" },
      }),

      // Tickets com SLA violado
      prisma.ticket.count({
        where: {
          companyId: { in: companyIds },
          slaBreached: true,
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      }),

      // Tickets em risco de SLA
      prisma.ticket.count({
        where: {
          companyId: { in: companyIds },
          slaAtRisk: true,
          slaBreached: false,
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      }),

      // NFS-e pendentes há mais de 24h
      prisma.invoice.count({
        where: {
          companyId: { in: companyIds },
          status: "PENDING",
          createdAt: { lt: oneDayAgo },
        },
      }),

      // Propostas sem resposta há 7+ dias
      prisma.proposal.count({
        where: {
          companyId: { in: companyIds },
          status: "SENT",
          updatedAt: { lt: sevenDaysAgo },
        },
      }),
    ]);

  if (slaBreachedCount > 0) {
    alerts.push({
      type: "SLA_BREACH",
      title: `${slaBreachedCount} ticket${slaBreachedCount > 1 ? "s" : ""} com SLA violado`,
      description: "Tickets que ultrapassaram o prazo de atendimento definido.",
      href: "/sac/tickets",
      severity: "critical",
      count: slaBreachedCount,
    });
  }

  if (overdueCount > 0) {
    alerts.push({
      type: "BOLETO_VENCIDO",
      title: `${overdueCount} boleto${overdueCount > 1 ? "s" : ""} vencido${overdueCount > 1 ? "s" : ""}`,
      description: "Boletos vencidos aguardando regularização ou cobrança.",
      href: "/comercial/propostas",
      severity: "critical",
      count: overdueCount,
    });
  }

  if (slaAtRiskCount > 0) {
    alerts.push({
      type: "SLA_RISK",
      title: `${slaAtRiskCount} ticket${slaAtRiskCount > 1 ? "s" : ""} com SLA em risco`,
      description: "Tickets próximos do prazo limite — ação urgente recomendada.",
      href: "/sac/tickets",
      severity: "warning",
      count: slaAtRiskCount,
    });
  }

  if (pendingNfseCount > 0) {
    alerts.push({
      type: "NFSE_FAILED",
      title: `${pendingNfseCount} NFS-e pendente${pendingNfseCount > 1 ? "s" : ""} há mais de 24h`,
      description: "Notas fiscais em estado PENDING por mais de 24h.",
      href: "/fiscal",
      severity: "warning",
      count: pendingNfseCount,
    });
  }

  if (oldSentProposalsCount > 0) {
    alerts.push({
      type: "PROPOSTA_SEM_RESPOSTA",
      title: `${oldSentProposalsCount} proposta${oldSentProposalsCount > 1 ? "s" : ""} sem resposta há +7 dias`,
      description: "Propostas enviadas sem aceite — pode ser hora de um follow-up.",
      href: "/comercial/propostas",
      severity: "warning",
      count: oldSentProposalsCount,
    });
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Standalone Server Actions (US-004)
// ---------------------------------------------------------------------------
// These provide independent access to each dashboard section.
// The main getDashboardData bundles them for efficient initial load.

export async function getRevenueExpenseChart(): Promise<MonthlyChartEntry[]> {
  const session = await requireSession();
  const companyIds = await resolveCompanyIds(session);
  if (companyIds.length === 0) return [];

  const now = new Date();
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const monthFullNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  const [monthlyRevenue, monthlyExpenses] = await Promise.all([
    prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
      SELECT date_trunc('month', "paidAt") AS month, SUM(value) AS total
      FROM accounts_receivable
      WHERE "companyId" = ANY(${companyIds})
        AND status = 'PAID'
        AND "paidAt" >= ${new Date(now.getFullYear(), now.getMonth() - 5, 1)}
        AND "paidAt" < ${new Date(now.getFullYear(), now.getMonth() + 1, 1)}
      GROUP BY date_trunc('month', "paidAt")
      ORDER BY month
    `,
    prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
      SELECT date_trunc('month', "paidAt") AS month, SUM(value) AS total
      FROM accounts_payable
      WHERE "companyId" = ANY(${companyIds})
        AND status = 'PAID'
        AND "paidAt" >= ${new Date(now.getFullYear(), now.getMonth() - 5, 1)}
        AND "paidAt" < ${new Date(now.getFullYear(), now.getMonth() + 1, 1)}
      GROUP BY date_trunc('month', "paidAt")
      ORDER BY month
    `,
  ]);

  const revenueByMonth = new Map<string, number>();
  for (const r of monthlyRevenue) {
    const d = new Date(r.month);
    revenueByMonth.set(`${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`, Number(r.total));
  }

  const expensesByMonth = new Map<string, number>();
  for (const e of monthlyExpenses) {
    const d = new Date(e.month);
    expensesByMonth.set(`${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`, Number(e.total));
  }

  const chart: MonthlyChartEntry[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    chart.push({
      month: monthFullNames[d.getMonth()],
      monthShort: monthNames[d.getMonth()],
      revenue: revenueByMonth.get(key) ?? 0,
      expenses: expensesByMonth.get(key) ?? 0,
    });
  }

  return chart;
}

export async function getUpcomingPayables(): Promise<UpcomingPayable[]> {
  const session = await requireSession();
  const companyIds = await resolveCompanyIds(session);
  if (companyIds.length === 0) return [];

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const payables = await prisma.accountPayable.findMany({
    where: {
      companyId: { in: companyIds },
      status: { in: ["PENDING", "OVERDUE"] },
      dueDate: { lte: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30) },
    },
    orderBy: { dueDate: "asc" },
    take: 8,
  });

  return payables.map((p) => {
    const dueDate = new Date(p.dueDate);
    const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const diffDays = Math.round((dueDateStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return {
      id: p.id,
      supplier: p.supplier,
      description: p.description,
      value: Number(p.value),
      dueDate: p.dueDate.toISOString(),
      isOverdue: diffDays < 0,
      daysUntilDue: diffDays,
    };
  });
}

export async function getRecentProposals(): Promise<RecentProposal[]> {
  const session = await requireSession();
  const companyIds = await resolveCompanyIds(session);
  if (companyIds.length === 0) return [];

  const proposals = await prisma.proposal.findMany({
    where: { companyId: { in: companyIds } },
    include: { client: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return proposals.map((p) => ({
    id: p.id,
    clientName: p.client.name,
    proposalNumber: `#P-${p.id.slice(-4).toUpperCase()}`,
    totalValue: Number(p.totalValue),
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function getSlaTickets(): Promise<TicketWithSLA[]> {
  const session = await requireSession();
  const companyIds = await resolveCompanyIds(session);
  if (companyIds.length === 0) return [];

  const tickets = await prisma.ticket.findMany({
    where: {
      companyId: { in: companyIds },
      status: { notIn: ["RESOLVED", "CLOSED"] },
      OR: [{ slaBreached: true }, { slaAtRisk: true }],
    },
    include: {
      client: { select: { name: true } },
      company: { select: { nomeFantasia: true } },
      assignee: { select: { name: true } },
    },
    orderBy: [{ slaBreached: "desc" }, { createdAt: "asc" }],
    take: 6,
  });

  return tickets.map((t) => ({
    id: t.id,
    subject: t.subject,
    clientName: t.client.name,
    companyName: t.company.nomeFantasia,
    priority: t.priority,
    slaStatus: t.slaBreached ? "breached" as const : "at_risk" as const,
    createdAt: t.createdAt.toISOString(),
    assigneeName: t.assignee?.name ?? null,
    assigneeInitials: t.assignee
      ? t.assignee.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
      : "?",
  }));
}
