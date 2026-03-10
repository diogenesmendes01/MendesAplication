"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  DollarSign,
  ShieldAlert,
  Gift,
  MessageSquare,
  Calendar,
  Headphones,
  ShoppingCart,
} from "lucide-react";
import {
  LazyBarChart as BarChart,
  LazyBar as Bar,
  LazyXAxis as XAxis,
  LazyYAxis as YAxis,
  LazyCartesianGrid as CartesianGrid,
  LazyTooltip as Tooltip,
  LazyResponsiveContainer as ResponsiveContainer,
} from "@/components/charts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KPICard } from "@/components/kpi-card";
import { EmptyState } from "@/components/empty-state";
import { AttentionCard } from "@/components/attention-card";
import {
  getDashboardData,
  getDashboardAlerts,
  type DashboardData,
  type DashboardAlert,
  type PeriodType,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatChartCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return `R$ ${value}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function relativeDate(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `Vencido há ${Math.abs(daysUntilDue)}d`;
  if (daysUntilDue === 0) return "Hoje";
  if (daysUntilDue === 1) return "Amanhã";
  return formatDate(new Date(Date.now() + daysUntilDue * 86400000).toISOString());
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "agora";
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

const proposalStatusConfig: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Rascunho", className: "bg-background-subtle text-text-secondary" },
  SENT: { label: "Aguardando", className: "bg-warning-subtle text-warning" },
  ACCEPTED: { label: "Fechada ✓", className: "bg-success-subtle text-success" },
  REJECTED: { label: "Rejeitada", className: "bg-danger-subtle text-danger" },
  EXPIRED: { label: "Expirada", className: "bg-background-subtle text-text-secondary" },
  CANCELLED: { label: "Cancelada", className: "bg-danger-subtle text-danger" },
};

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "day", label: "Hoje" },
  { value: "week", label: "Esta Semana" },
  { value: "month", label: "Este Mês" },
  { value: "year", label: "Este Ano" },
  { value: "custom", label: "Personalizado" },
];

// ---------------------------------------------------------------------------
// Chart tooltip
// ---------------------------------------------------------------------------

function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-md">
      <p className="mb-1 text-body-sm font-medium text-text-primary">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-body-sm" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* KPI skeletons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px]">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-5 animate-pulse">
            <div className="h-10 w-10 rounded-[10px] bg-border-subtle mb-4" />
            <div className="h-7 w-28 rounded bg-border-subtle mb-2" />
            <div className="h-3 w-20 rounded bg-border-subtle mb-3" />
            <div className="h-5 w-24 rounded-full bg-border-subtle" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[14px]">
        <div className="lg:col-span-2 rounded-xl border border-border bg-surface p-5 animate-pulse">
          <div className="h-5 w-40 rounded bg-border-subtle mb-2" />
          <div className="h-3 w-24 rounded bg-border-subtle mb-6" />
          <div className="h-[180px] bg-border-subtle rounded" />
        </div>
        <div className="rounded-xl border border-border bg-surface p-5 animate-pulse">
          <div className="h-5 w-40 rounded bg-border-subtle mb-2" />
          <div className="h-3 w-24 rounded bg-border-subtle mb-6" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-border-subtle" />
                <div className="flex-1 h-4 rounded bg-border-subtle" />
                <div className="h-4 w-16 rounded bg-border-subtle" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodType>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getDashboardData({
        period,
        customStart: period === "custom" ? customStart : undefined,
        customEnd: period === "custom" ? customEnd : undefined,
      });
      setData(result);
    } catch {
      toast.error("Erro ao carregar dados do dashboard");
    } finally {
      setLoading(false);
    }
  }, [period, customStart, customEnd]);

  const loadAlerts = useCallback(async () => {
    try {
      const result = await getDashboardAlerts();
      setAlerts(result);
    } catch {
      // silent — don't break dashboard
    }
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    if (period === "custom" && (!customStart || !customEnd)) return;
    loadData();
  }, [loadData, period, customStart, customEnd]);

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-1 duration-300">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-text-primary">Dashboard</h1>
          {data && (
            <p className="text-body-sm text-text-secondary mt-0.5">
              Visão geral — {data.periodLabel}
            </p>
          )}
        </div>

        {/* Period filter */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="mb-1 block text-caption text-text-tertiary">Período</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodType)}>
              <SelectTrigger className="w-[140px] h-9 text-body-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {period === "custom" && (
            <>
              <div>
                <Label className="mb-1 block text-caption text-text-tertiary">De</Label>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-[140px] h-9"
                />
              </div>
              <div>
                <Label className="mb-1 block text-caption text-text-tertiary">Até</Label>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-[140px] h-9"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Attention Card — above KPIs, only when there are alerts */}
      {alerts.length > 0 && <AttentionCard alerts={alerts} />}

      {/* Loading state */}
      {loading ? (
        <DashboardSkeleton />
      ) : data ? (
        <>
          {/* ── Row 1: KPI Cards ── */}
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px] animate-in fade-in slide-in-from-bottom-2 duration-400"
          >
            <KPICard
              icon={<DollarSign className="h-5 w-5 text-accent" strokeWidth={1.75} />}
              iconBg="hsl(var(--accent-subtle))"
              value={data.kpis.revenue}
              label="Receita do mês"
              previousValue={data.kpis.revenuePrevious}
            />
            <KPICard
              icon={<ShieldAlert className="h-5 w-5 text-warning" strokeWidth={1.75} />}
              iconBg="hsl(var(--warning-subtle))"
              value={data.kpis.expenses}
              label="Despesas do mês"
              previousValue={data.kpis.expensesPrevious}
            />
            <KPICard
              icon={<Gift className="h-5 w-5 text-success" strokeWidth={1.75} />}
              iconBg="hsl(var(--success-subtle))"
              value={data.kpis.balance}
              label="Saldo líquido"
              previousValue={data.kpis.balancePrevious}
              badgeOverride={
                data.kpis.revenue > 0
                  ? {
                      text: `Margem ${((data.kpis.balance / data.kpis.revenue) * 100).toFixed(1)}%`,
                      variant: data.kpis.balance >= 0 ? "up" : "down",
                    }
                  : undefined
              }
            />
            <KPICard
              icon={<MessageSquare className="h-5 w-5 text-danger" strokeWidth={1.75} />}
              iconBg="hsl(var(--danger-subtle))"
              value={data.kpis.openTickets}
              label="Tickets abertos"
              format="number"
              badgeOverride={
                data.kpis.openTicketsCritical > 0
                  ? {
                      text: `${data.kpis.openTicketsCritical} com SLA crítico`,
                      variant: "danger",
                    }
                  : undefined
              }
            />
          </div>

          {/* ── Row 2: Chart + Upcoming ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[14px] animate-in fade-in slide-in-from-bottom-2 duration-400 delay-100">
            {/* Revenue × Expenses chart */}
            <div className="lg:col-span-2 rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Receita × Despesas</div>
                  <div className="text-caption text-text-secondary mt-0.5">Últimos 6 meses</div>
                </div>
                <div className="flex gap-3.5 items-center">
                  <div className="flex items-center gap-1.5 text-caption text-text-secondary">
                    <div className="h-2 w-2 rounded-full bg-accent" />
                    Receita
                  </div>
                  <div className="flex items-center gap-1.5 text-caption text-text-secondary">
                    <div className="h-2 w-2 rounded-full" style={{ background: "#F59E0B" }} />
                    Despesas
                  </div>
                </div>
              </div>
              <div className="p-5">
                {data.monthlyChart.some((m) => m.revenue > 0 || m.expenses > 0) ? (
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={data.monthlyChart}
                        margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                        barGap={3}
                      >
                        <CartesianGrid
                          strokeDasharray="0"
                          stroke="hsl(var(--border-subtle))"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="monthShort"
                          tick={{ fontSize: 11, fill: "hsl(var(--text-tertiary))" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "hsl(var(--text-tertiary))" }}
                          tickFormatter={formatChartCurrency}
                          axisLine={false}
                          tickLine={false}
                          width={60}
                        />
                        <Tooltip content={<ChartTooltipContent />} />
                        <Bar
                          dataKey="revenue"
                          name="Receita"
                          fill="hsl(var(--accent))"
                          radius={[5, 5, 0, 0]}
                        />
                        <Bar
                          dataKey="expenses"
                          name="Despesas"
                          fill="#F59E0B"
                          radius={[5, 5, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Calendar className="h-12 w-12" strokeWidth={1.5} />}
                    title="Sem dados no período"
                    description="Registre receitas e despesas para visualizar o gráfico."
                  />
                )}
              </div>
            </div>

            {/* Upcoming payables */}
            <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Próximos Vencimentos</div>
                  <div className="text-caption text-text-secondary mt-0.5">Contas a pagar</div>
                </div>
                <Link
                  href="/financeiro/pagar"
                  className="text-caption font-medium text-text-secondary hover:text-text-primary border border-border rounded-md px-2.5 py-1 transition-colors"
                >
                  Ver todos
                </Link>
              </div>
              <div className="px-5 py-3">
                {data.upcomingPayables.length > 0 ? (
                  <div className="divide-y divide-border-subtle">
                    {data.upcomingPayables.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 py-2.5">
                        <div
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{
                            background: p.isOverdue
                              ? "hsl(var(--danger))"
                              : p.daysUntilDue <= 1
                              ? "hsl(var(--warning))"
                              : "hsl(var(--text-tertiary))",
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-body-sm font-medium text-text-primary truncate">
                            {p.supplier}
                          </div>
                          <div className="text-[11.5px] text-text-tertiary">
                            {relativeDate(p.daysUntilDue)}
                            {p.isOverdue && " · Vencido"}
                          </div>
                        </div>
                        <div
                          className="text-body-sm font-semibold whitespace-nowrap"
                          style={{
                            fontVariantNumeric: "tabular-nums",
                            color: p.isOverdue
                              ? "hsl(var(--danger))"
                              : p.daysUntilDue <= 1
                              ? "hsl(var(--warning))"
                              : undefined,
                          }}
                        >
                          {formatCurrency(p.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Calendar className="h-10 w-10" strokeWidth={1.5} />}
                    title="Tudo em dia"
                    description="Nenhuma conta próxima do vencimento."
                    className="py-8"
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Row 3: Proposals + Tickets ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px] animate-in fade-in slide-in-from-bottom-2 duration-400 delay-200">
            {/* Recent proposals */}
            <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Propostas Recentes</div>
                  <div className="text-caption text-text-secondary mt-0.5">Pipeline comercial</div>
                </div>
                <Link
                  href="/comercial/pipeline"
                  className="text-caption font-medium text-text-secondary hover:text-text-primary border border-border rounded-md px-2.5 py-1 transition-colors"
                >
                  Ver pipeline
                </Link>
              </div>
              {data.recentProposals.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-5 pb-2.5 pt-4">
                          Cliente
                        </th>
                        <th className="text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-5 pb-2.5 pt-4">
                          Valor
                        </th>
                        <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-tertiary px-5 pb-2.5 pt-4">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentProposals.map((p) => {
                        const statusCfg = proposalStatusConfig[p.status] ?? proposalStatusConfig.DRAFT;
                        return (
                          <tr
                            key={p.id}
                            className="hover:bg-background-subtle transition-colors cursor-pointer"
                            onClick={() => (window.location.href = `/comercial/propostas/${p.id}`)}
                          >
                            <td className="px-5 py-2.5 border-t border-border-subtle">
                              <div className="text-body-sm font-medium text-text-primary">
                                {p.clientName}
                              </div>
                              <div className="text-[11.5px] text-text-tertiary">
                                {p.proposalNumber}
                              </div>
                            </td>
                            <td
                              className="px-5 py-2.5 border-t border-border-subtle text-right text-body-sm font-semibold"
                              style={{ fontVariantNumeric: "tabular-nums" }}
                            >
                              {formatCurrency(p.totalValue)}
                            </td>
                            <td className="px-5 py-2.5 border-t border-border-subtle">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold before:content-[''] before:h-[5px] before:w-[5px] before:rounded-full before:bg-current ${statusCfg.className}`}
                              >
                                {statusCfg.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={<ShoppingCart className="h-12 w-12" strokeWidth={1.5} />}
                  title="Nenhuma proposta"
                  description="Crie sua primeira proposta comercial."
                  actionLabel="Nova Proposta"
                  actionHref="/comercial/propostas/nova"
                />
              )}
            </div>

            {/* Tickets with SLA */}
            <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Tickets em Alerta</div>
                  <div className="text-caption text-text-secondary mt-0.5">SLA crítico ou violado</div>
                </div>
                {data.ticketsWithSLA.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-subtle px-2.5 py-1 text-caption font-semibold text-danger">
                    {data.ticketsWithSLA.filter((t) => t.slaStatus === "breached").length} críticos
                  </span>
                )}
              </div>
              <div className="px-5 py-2">
                {data.ticketsWithSLA.length > 0 ? (
                  <div className="divide-y divide-border-subtle">
                    {data.ticketsWithSLA.map((t) => {
                      const avatarColors =
                        t.slaStatus === "breached"
                          ? "bg-danger-subtle text-danger"
                          : "bg-warning-subtle text-warning";
                      return (
                        <Link
                          key={t.id}
                          href={`/sac/tickets/${t.id}`}
                          className="flex items-start gap-3 py-2.5 hover:opacity-80 transition-opacity"
                        >
                          <div
                            className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${avatarColors}`}
                          >
                            {t.assigneeInitials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-body-sm font-medium text-text-primary truncate">
                              {t.subject}
                            </div>
                            <div className="text-[11.5px] text-text-tertiary mt-0.5">
                              {t.clientName} · {t.companyName} · {timeAgo(t.createdAt)}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span
                              className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                                t.slaStatus === "breached"
                                  ? "bg-danger-subtle text-danger"
                                  : "bg-warning-subtle text-warning"
                              }`}
                            >
                              {t.slaStatus === "breached" ? "SLA violado" : "Em risco"}
                            </span>
                            <span className="text-[11px] text-text-tertiary">
                              #{t.id.slice(-4).toUpperCase()}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Headphones className="h-12 w-12" strokeWidth={1.5} />}
                    title="Nenhum alerta de SLA"
                    description="Todos os tickets estão dentro do prazo."
                    className="py-8"
                  />
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
