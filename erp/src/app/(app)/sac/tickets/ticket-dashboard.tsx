"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { ChannelType } from "@prisma/client";
import {
  Inbox,
  Loader2,
  Clock,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Coins,
  Timer,
} from "lucide-react";
import {
  LazyBarChart as BarChart,
  LazyBar as Bar,
  LazyXAxis as XAxis,
  LazyYAxis as YAxis,
  LazyTooltip as Tooltip,
  LazyResponsiveContainer as ResponsiveContainer,
  LazyCell as Cell,
} from "@/components/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTicketDashboard, type TicketDashboard } from "./dashboard-actions";
import { RaReputationCard } from "./ra-reputation-card";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelLabel(channel: string) {
  switch (channel) {
    case "EMAIL":
      return "Email";
    case "WHATSAPP":
      return "WhatsApp";
    case "RECLAMEAQUI":
      return "Reclame Aqui";
    default:
      return "Web/Manual";
  }
}

function channelColor(channel: string) {
  switch (channel) {
    case "EMAIL":
      return "#3b82f6";
    case "WHATSAPP":
      return "#22c55e";
    case "RECLAMEAQUI":
      return "#8b5cf6";
    default:
      return "#94a3b8";
  }
}

function priorityLabel(priority: string) {
  switch (priority) {
    case "HIGH":
      return "Alta";
    case "LOW":
      return "Baixa";
    default:
      return "Média";
  }
}

function priorityColor(priority: string) {
  switch (priority) {
    case "HIGH":
      return "#ef4444";
    case "LOW":
      return "#3b82f6";
    default:
      return "#eab308";
  }
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  title,
  value,
  icon: Icon,
  className,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart Tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number; payload: { label: string } }[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-sm">
      <p className="font-medium">{payload[0].payload.label}</p>
      <p className="text-muted-foreground">{payload[0].value} tickets</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TicketDashboardKpisProps {
  companyId: string;
  /** When provided, KPIs are filtered to this channel only (PR #362 fix) */
  channelType?: ChannelType;
}

export function TicketDashboardKpis({
  companyId,
  channelType,
}: TicketDashboardKpisProps) {
  const [data, setData] = useState<TicketDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getTicketDashboard(companyId, channelType);
      setData(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar dashboard"
      );
    } finally {
      setLoading(false);
    }
  }, [companyId, channelType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Carregando dashboard...
      </div>
    );
  }

  if (!data) return null;

  const channelData = data.ticketsByChannel.map((item) => ({
    label: channelLabel(item.channel),
    value: item.count,
    color: channelColor(item.channel),
  }));

  const priorityData = data.ticketsByPriority.map((item) => ({
    label: priorityLabel(item.priority),
    value: item.count,
    color: priorityColor(item.priority),
  }));

  // When showing a specific channel, omit the RA reputation card and bar chart
  // (ChannelDashboard already handles those above)
  const isChannelView = !!channelType;

  return (
    <div className="space-y-6">
      {/* RA Reputation + KPI Cards — only show full layout in master view */}
      {isChannelView ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Abertos"
            value={data.openCount}
            icon={Inbox}
          />
          <KpiCard
            title="Em Andamento"
            value={data.inProgressCount}
            icon={Clock}
          />
          <KpiCard
            title="Aguardando Cliente"
            value={data.waitingClientCount}
            icon={UserCheck}
          />
          <KpiCard
            title="Resolvidos Hoje"
            value={data.resolvedTodayCount}
            icon={CheckCircle2}
          />
          <KpiCard
            title="SLA Estourado"
            value={data.slaBreachedCount}
            icon={AlertOctagon}
            className={
              data.slaBreachedCount > 0
                ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
                : undefined
            }
          />
          <KpiCard
            title="Tempo Médio Resposta"
            value={formatMinutes(data.avgResponseTimeMinutes)}
            icon={Timer}
          />
          <KpiCard
            title="Reembolsos Pendentes"
            value={data.pendingRefundsCount}
            icon={Coins}
          />
          {/* Priority chart inline for channel view */}
          {priorityData.length > 0 && (
            <Card className="sm:col-span-2 lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Por Prioridade
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer
                  width="100%"
                  height={priorityData.length * 36 + 16}
                >
                  <BarChart
                    data={priorityData}
                    layout="vertical"
                    margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={60}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                      {priorityData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          {/* RA Reputation Card — renders null if no RA channel */}
          <RaReputationCard companyId={companyId} />

          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Abertos"
              value={data.openCount}
              icon={Inbox}
            />
            <KpiCard
              title="Em Andamento"
              value={data.inProgressCount}
              icon={Clock}
            />
            <KpiCard
              title="Aguardando Cliente"
              value={data.waitingClientCount}
              icon={UserCheck}
            />
            <KpiCard
              title="Resolvidos Hoje"
              value={data.resolvedTodayCount}
              icon={CheckCircle2}
            />
            <KpiCard
              title="SLA Estourado"
              value={data.slaBreachedCount}
              icon={AlertOctagon}
              className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
            />
            <KpiCard
              title="SLA em Risco"
              value={data.slaAtRiskCount}
              icon={AlertTriangle}
              className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
            />
            <KpiCard
              title="Reembolsos Pendentes"
              value={data.pendingRefundsCount}
              icon={Coins}
            />
            <KpiCard
              title="Tempo Médio Resposta"
              value={formatMinutes(data.avgResponseTimeMinutes)}
              icon={Timer}
            />
          </div>
        </div>
      )}

      {/* Charts — only show in master view (channel view shows ChannelDashboard above) */}
      {!isChannelView && (channelData.length > 0 || priorityData.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* By Channel */}
          {channelData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Tickets por Canal
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={channelData.length * 48 + 20}>
                  <BarChart
                    data={channelData}
                    layout="vertical"
                    margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={90}
                      tick={{ fontSize: 13 }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                      {channelData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* By Priority */}
          {priorityData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Tickets por Prioridade
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={priorityData.length * 48 + 20}>
                  <BarChart
                    data={priorityData}
                    layout="vertical"
                    margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={90}
                      tick={{ fontSize: 13 }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                      {priorityData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
