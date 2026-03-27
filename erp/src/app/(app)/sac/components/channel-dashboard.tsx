"use client";

import { useState, useEffect, useCallback } from "react";
import type { ChannelType } from "@prisma/client";
import { toast } from "sonner";
import {
  Inbox,
  CheckCircle2,
  Clock,
  Timer,
  MessageSquare,
  UserCheck,
  Bot,
  UserCog,
  Star,
  BarChart2,
  TrendingUp,
  Hourglass,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/contexts/company-context";
import {
  getChannelDashboard,
  type ChannelDashboardData,
} from "../tickets/dashboard-actions";
import { RaReputationCard } from "../tickets/ra-reputation-card";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ---------------------------------------------------------------------------
// KPI Card (matches ticket-dashboard.tsx style)
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
// Email KPIs
// ---------------------------------------------------------------------------

function EmailKpis({ data }: { data: ChannelDashboardData }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title="Inbox Pendente"
        value={data.inboxPendente ?? 0}
        icon={Inbox}
      />
      <KpiCard
        title="Respondidos Hoje"
        value={data.respondidosHoje ?? 0}
        icon={CheckCircle2}
      />
      <KpiCard
        title="Backlog >24h"
        value={data.backlog24h ?? 0}
        icon={Hourglass}
        className={
          (data.backlog24h ?? 0) > 0
            ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
            : undefined
        }
      />
      <KpiCard
        title="Tempo Médio Resposta"
        value={formatMinutes(data.avgResponseTimeMinutes ?? 0)}
        icon={Timer}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp KPIs
// ---------------------------------------------------------------------------

function WhatsAppKpis({ data }: { data: ChannelDashboardData }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title="Conversas Ativas"
        value={data.conversasAtivas ?? 0}
        icon={MessageSquare}
      />
      <KpiCard
        title="Aguardando Cliente"
        value={data.aguardandoCliente ?? 0}
        icon={UserCheck}
      />
      <KpiCard
        title="IA Auto-respondeu"
        value={data.iaAutoRespondeu ?? 0}
        icon={Bot}
      />
      <KpiCard
        title="Precisa Humano"
        value={data.precisaHumano ?? 0}
        icon={UserCog}
        className={
          (data.precisaHumano ?? 0) > 0
            ? "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950"
            : undefined
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReclameAqui KPIs
// ---------------------------------------------------------------------------

function ReclameAquiKpis({
  data,
  companyId,
}: {
  data: ChannelDashboardData;
  companyId: string;
}) {
  const total = data.total ?? 0;
  const respondidas = data.respondidas ?? 0;
  const taxaResolucao = data.taxaResolucao ?? 0;
  const notaGeral = data.notaGeral ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Nota Geral"
          value={notaGeral > 0 ? notaGeral.toFixed(1) : "—"}
          icon={Star}
          className={
            notaGeral >= 7
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
              : notaGeral > 0 && notaGeral < 5
              ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
              : undefined
          }
        />
        <KpiCard
          title="Respondidas / Total"
          value={total > 0 ? `${respondidas}/${total}` : "—"}
          icon={BarChart2}
        />
        <KpiCard
          title="Taxa Resolução"
          value={total > 0 ? `${taxaResolucao.toFixed(0)}%` : "—"}
          icon={TrendingUp}
          className={
            taxaResolucao >= 70
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
              : undefined
          }
        />
        <KpiCard
          title="Aguardando Moderação"
          value={data.aguardandoModeracao ?? 0}
          icon={Clock}
          className={
            (data.aguardandoModeracao ?? 0) > 0
              ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
              : undefined
          }
        />
      </div>

      {/* RA Reputation Card */}
      <RaReputationCard companyId={companyId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface ChannelDashboardProps {
  channelType: ChannelType;
}

export function ChannelDashboard({ channelType }: ChannelDashboardProps) {
  const { selectedCompanyId } = useCompany();
  const [data, setData] = useState<ChannelDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await getChannelDashboard(selectedCompanyId, channelType);
      setData(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar dashboard do canal"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, channelType]);

  useEffect(() => {
    load();
  }, [load]);

  if (!selectedCompanyId) return null;

  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando métricas...
      </div>
    );
  }

  if (!data) return null;

  if (channelType === "EMAIL") {
    return <EmailKpis data={data} />;
  }

  if (channelType === "WHATSAPP") {
    return <WhatsAppKpis data={data} />;
  }

  if (channelType === "RECLAMEAQUI") {
    return <ReclameAquiKpis data={data} companyId={selectedCompanyId} />;
  }

  return null;
}
