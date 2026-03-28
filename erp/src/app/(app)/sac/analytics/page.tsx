"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  DollarSign,
  Zap,
  TrendingUp,
  AlertTriangle,
  ThumbsUp,
  PhoneForwarded,
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/company-context";
import {
  getAiKpis,
  getCostByDay,
  getCostByChannel,
  getTopTicketsByCost,
  getSuggestionBreakdown,
  getConfidenceCalibration,
  getEscalationRate,
  getRecentEscalations,
  getTopTools,
  type AiKpis,
  type CostByDay,
  type CostByChannel,
  type TopTicketCost,
  type SuggestionBreakdown,
  type ConfidenceBucket,
  type EscalationData,
  type ToolUsage,
} from "./actions";
import { AlertsPanel } from "./components/alerts-panel";

// ─── Period Helpers ───────────────────────────────────────────────────────────

type PeriodKey = "7d" | "30d" | "90d";

function getPeriodRange(key: PeriodKey): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  switch (key) {
    case "7d":
      from.setDate(from.getDate() - 7);
      break;
    case "30d":
      from.setDate(from.getDate() - 30);
      break;
    case "90d":
      from.setDate(from.getDate() - 90);
      break;
  }
  return { from, to };
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: "#25D366",
  EMAIL: "#3B82F6",
  RECLAMEAQUI: "#8B5CF6",
};
const PIE_COLORS = ["#25D366", "#3B82F6", "#8B5CF6", "#F59E0B"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { selectedCompanyId } = useCompany();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [isPending, startTransition] = useTransition();

  const [kpis, setKpis] = useState<AiKpis | null>(null);
  const [costByDay, setCostByDay] = useState<CostByDay[]>([]);
  const [costByChannel, setCostByChannel] = useState<CostByChannel[]>([]);
  const [topTickets, setTopTickets] = useState<TopTicketCost[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionBreakdown | null>(null);
  const [calibration, setCalibration] = useState<ConfidenceBucket[]>([]);
  const [escalation, setEscalation] = useState<EscalationData | null>(null);
  const [recentEscalations, setRecentEscalations] = useState<
    { ticketId: string; subject: string; channel: string | null; escalatedAt: Date }[]
  >([]);
  const [topTools, setTopTools] = useState<ToolUsage[]>([]);

  const loadData = useCallback(() => {
    if (!selectedCompanyId) return;
    const range = getPeriodRange(period);

    startTransition(async () => {
      const [
        kpisData, costByDayData, costByChannelData, topTicketsData,
        suggestionsData, calibrationData, escalationData, escalationsData, toolsData,
      ] = await Promise.all([
        getAiKpis(selectedCompanyId, range),
        getCostByDay(selectedCompanyId, range),
        getCostByChannel(selectedCompanyId, range),
        getTopTicketsByCost(selectedCompanyId, range),
        getSuggestionBreakdown(selectedCompanyId, range),
        getConfidenceCalibration(selectedCompanyId, range),
        getEscalationRate(selectedCompanyId, range),
        getRecentEscalations(selectedCompanyId),
        getTopTools(selectedCompanyId, range),
      ]);

      setKpis(kpisData);
      setCostByDay(costByDayData);
      setCostByChannel(costByChannelData);
      setTopTickets(topTicketsData);
      setSuggestions(suggestionsData);
      setCalibration(calibrationData);
      setEscalation(escalationData);
      setRecentEscalations(escalationsData);
      setTopTools(toolsData);
    });
  }, [selectedCompanyId, period]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para ver analytics de IA.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🔍 Observabilidade da IA</h1>
          <p className="text-sm text-muted-foreground">
            Métricas de performance, custos e eficácia do agente
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="90d">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Row 1: KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="Custo Total" value={kpis ? `R$ ${kpis.totalCostBrl.toFixed(2)}` : "—"} icon={DollarSign} loading={isPending} />
        <KpiCard title="Chamadas" value={kpis ? kpis.totalCalls.toLocaleString("pt-BR") : "—"} icon={Zap} loading={isPending} />
        <KpiCard title="Custo/Chamada" value={kpis ? `R$ ${kpis.avgCostPerCall.toFixed(4)}` : "—"} icon={DollarSign} loading={isPending} />
        <KpiCard
          title="Resolução IA"
          value={kpis ? `${(kpis.aiResolutionRate * 100).toFixed(0)}%` : "—"}
          subtitle={kpis ? `${kpis.aiResolvedTickets} IA / ${kpis.humanResolvedTickets} humano` : undefined}
          icon={TrendingUp} loading={isPending}
        />
        <KpiCard
          title="Escalação"
          value={escalation ? `${(escalation.rate * 100).toFixed(0)}%` : "—"}
          subtitle={escalation ? `${escalation.escalatedCount} de ${escalation.totalAiTickets}` : undefined}
          icon={PhoneForwarded} loading={isPending}
        />
        <KpiCard
          title="Aprovação"
          value={suggestions ? `${(suggestions.approvalRate * 100).toFixed(0)}%` : "—"}
          subtitle={suggestions ? `${suggestions.approved + suggestions.edited} de ${suggestions.total}` : undefined}
          icon={ThumbsUp} loading={isPending}
        />
      </div>

      {/* Row 2: Cost by Day chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custo por Dia (BRL)</CardTitle>
        </CardHeader>
        <CardContent>
          {costByDay.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sem dados no período selecionado.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={costByDay}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => {
                  const d = new Date(v + "T12:00:00");
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `R$${v.toFixed(2)}`} />
                <Tooltip
                  formatter={(v: number) => [`R$ ${v.toFixed(4)}`, "Custo"]}
                  labelFormatter={(l: string) => new Date(l + "T12:00:00").toLocaleDateString("pt-BR")}
                />
                <Bar dataKey="costBrl" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Row 3: Cost by Channel + Confidence Calibration */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Custo por Canal</CardTitle></CardHeader>
          <CardContent>
            {costByChannel.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sem dados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={costByChannel} dataKey="costBrl" nameKey="channel" cx="50%" cy="50%" outerRadius={100}
                    label={({ channel, costBrl }: CostByChannel) => `${channel} R$${costBrl.toFixed(2)}`}>
                    {costByChannel.map((entry, i) => (
                      <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] ?? PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`R$ ${v.toFixed(4)}`, "Custo"]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Calibração de Confidence</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2">Faixa</th>
                    <th className="pb-2 text-right">Total</th>
                    <th className="pb-2 text-right">Aprovados</th>
                    <th className="pb-2 text-right">Taxa Real</th>
                  </tr>
                </thead>
                <tbody>
                  {calibration.map((b) => (
                    <tr key={b.label} className="border-b last:border-0">
                      <td className="py-2 font-medium">{b.label}</td>
                      <td className="py-2 text-right">{b.total}</td>
                      <td className="py-2 text-right">{b.approved}</td>
                      <td className="py-2 text-right">
                        {b.total > 0 ? (
                          <Badge variant={b.rate >= 0.7 ? "default" : b.rate >= 0.5 ? "secondary" : "destructive"}>
                            {(b.rate * 100).toFixed(0)}%
                          </Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Top Tickets + Top Tools */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Tickets Mais Caros</CardTitle></CardHeader>
          <CardContent>
            {topTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sem dados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2">Ticket</th>
                      <th className="pb-2 text-right">Custo</th>
                      <th className="pb-2 text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topTickets.map((t) => (
                      <tr key={t.ticketId} className="border-b last:border-0">
                        <td className="py-2 font-mono text-xs">{t.ticketId.slice(0, 8)}…</td>
                        <td className="py-2 text-right">R$ {t.costBrl.toFixed(4)}</td>
                        <td className="py-2 text-right text-muted-foreground">
                          {(t.inputTokens + t.outputTokens).toLocaleString("pt-BR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Tools Mais Usadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topTools.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sem dados.</p>
            ) : (
              <div className="space-y-2">
                {topTools.map((t, i) => (
                  <div key={t.tool} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-5">#{i + 1}</span>
                      <span className="text-sm font-mono">{t.tool}</span>
                    </div>
                    <Badge variant="secondary">{t.count}x</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 5: Recent Escalations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" /> Escalações Recentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentEscalations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma escalação recente.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2">Ticket</th>
                    <th className="pb-2">Assunto</th>
                    <th className="pb-2">Canal</th>
                    <th className="pb-2 text-right">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEscalations.map((e) => (
                    <tr key={e.ticketId} className="border-b last:border-0">
                      <td className="py-2 font-mono text-xs">{e.ticketId.slice(0, 8)}…</td>
                      <td className="py-2 max-w-[200px] truncate">{e.subject}</td>
                      <td className="py-2">{e.channel ? <Badge variant="outline">{e.channel}</Badge> : "—"}</td>
                      <td className="py-2 text-right text-muted-foreground">
                        {new Date(e.escalatedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 6: Alerts Config */}
      <AlertsPanel companyId={selectedCompanyId} />
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ title, value, subtitle, icon: Icon, loading }: {
  title: string; value: string; subtitle?: string;
  icon: React.ComponentType<{ className?: string }>; loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{title}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className={`text-xl font-bold ${loading ? "animate-pulse text-muted-foreground" : ""}`}>{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}
