"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Inbox,
  AlertOctagon,
  Coins,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Clock,
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
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/contexts/company-context";
import { getTicketDashboard, type TicketDashboard } from "../tickets/dashboard-actions";

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

function priorityVariant(
  priority: string
): "destructive" | "secondary" | "outline" {
  switch (priority) {
    case "HIGH":
      return "destructive";
    case "MEDIUM":
      return "secondary";
    default:
      return "outline";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "OPEN":
      return "Aberto";
    case "IN_PROGRESS":
      return "Em Andamento";
    case "WAITING_CLIENT":
      return "Ag. Cliente";
    default:
      return status;
  }
}

function timeAgo(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `${diffMins}min atrás`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h atrás`;
  return `${Math.floor(diffHours / 24)}d atrás`;
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

export function MasterDashboard() {
  const { selectedCompanyId } = useCompany();
  const [data, setData] = useState<TicketDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await getTicketDashboard(selectedCompanyId);
      setData(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar dashboard"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar o dashboard.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
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

  return (
    <div className="space-y-6">
      {/* Row 1: KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Abertos"
          value={data.openCount}
          icon={Inbox}
        />
        <KpiCard
          title="SLA Violado"
          value={data.slaBreachedCount}
          icon={AlertOctagon}
          className={
            data.slaBreachedCount > 0
              ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
              : undefined
          }
        />
        <KpiCard
          title="Reembolsos Pendentes"
          value={data.pendingRefundsCount}
          icon={Coins}
          className={
            data.pendingRefundsCount > 0
              ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
              : undefined
          }
        />
        <KpiCard
          title="Resolvidos Hoje"
          value={data.resolvedTodayCount}
          icon={CheckCircle2}
        />
      </div>

      {/* Row 2: Bar chart — tickets por canal */}
      {channelData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Tickets Ativos por Canal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer
              width="100%"
              height={channelData.length * 52 + 20}
            >
              <BarChart
                data={channelData}
                layout="vertical"
                margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
              >
                <XAxis type="number" allowDecimals={false} hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={100}
                  tick={{ fontSize: 13 }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
                  {channelData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Row 3: Top 5 urgent tickets */}
      {data.urgentTickets.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertOctagon className="h-4 w-4 text-red-500" />
              Tickets Urgentes — SLA Estourado
            </CardTitle>
            <Link
              href="/sac"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {data.urgentTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/sac/tickets/${ticket.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-muted/50 -mx-2 px-2 rounded-md transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {ticket.subject}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {timeAgo(ticket.updatedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={priorityVariant(ticket.priority)}>
                      {priorityLabel(ticket.priority)}
                    </Badge>
                    <span className="text-xs text-muted-foreground hidden sm:block">
                      {statusLabel(ticket.status)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.urgentTickets.length === 0 && data.slaBreachedCount === 0 && (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Nenhum SLA estourado. Ótimo trabalho!
        </div>
      )}
    </div>
  );
}
