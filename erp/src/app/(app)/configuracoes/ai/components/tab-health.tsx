"use client";

import { useState, useCallback } from "react";
import {
  HeartPulse,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  getProviderHealth,
  getProviderHistory,
  configFallbackChain,
} from "../health-actions";
import type {
  HealthDashboardData,
  ProviderHealthHistoryEntry,
} from "../health-actions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TabHealthProps {
  companyId: string;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusIcon(status: string) {
  switch (status) {
    case "up":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "degraded":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "down":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "up":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">UP</Badge>;
    case "degraded":
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">DEGRADED</Badge>;
    case "down":
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">DOWN</Badge>;
    default:
      return <Badge variant="outline">Desconhecido</Badge>;
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.round(diff / 3_600_000)}h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Latency sparkline (simple ASCII-style bar chart in CSS)
// ---------------------------------------------------------------------------

function LatencyBar({ entries }: { entries: ProviderHealthHistoryEntry[] }) {
  if (entries.length === 0) return <span className="text-xs text-muted-foreground">Sem dados</span>;

  const maxLatency = Math.max(...entries.map((e) => e.latencyMs ?? 0), 1);
  // Take last 30 entries for display
  const recent = entries.slice(-30);

  return (
    <div className="flex items-end gap-[2px] h-8">
      {recent.map((entry, i) => {
        const height = entry.latencyMs ? Math.max(2, (entry.latencyMs / maxLatency) * 100) : 2;
        const color =
          entry.status === "down"
            ? "bg-red-500"
            : entry.status === "degraded"
              ? "bg-yellow-500"
              : "bg-green-500";
        return (
          <div
            key={i}
            className={`w-1.5 rounded-t ${color}`}
            style={{ height: `${height}%` }}
            title={`${entry.latencyMs ?? "—"}ms — ${entry.status} — ${new Date(entry.checkedAt).toLocaleString("pt-BR")}`}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TabHealth({ companyId }: TabHealthProps) {
  const [data, setData] = useState<HealthDashboardData | null>(null);
  const [history, setHistory] = useState<ProviderHealthHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, historyData] = await Promise.all([
        getProviderHealth(companyId),
        getProviderHistory(companyId, 24),
      ]);
      setData(healthData);
      setHistory(historyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const handleToggleHealthCheck = useCallback(
    async (enabled: boolean) => {
      if (!data) return;
      setSaving(true);
      const result = await configFallbackChain(companyId, data.fallbackChain, enabled);
      if (result.success) {
        setData((prev) => (prev ? { ...prev, healthCheckEnabled: enabled } : prev));
      }
      setSaving(false);
    },
    [companyId, data],
  );

  // ── Initial state ────────────────────────────────────────────────────────
  if (!data && !loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <HeartPulse className="h-5 w-5" />
              Saúde dos Providers de IA
            </CardTitle>
            <CardDescription>
              Monitore a disponibilidade e latência dos providers configurados
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-8 gap-3">
            <p className="text-sm text-muted-foreground">
              Clique para carregar o status dos providers de IA.
            </p>
            <Button onClick={loadData} disabled={loading}>
              <Activity className="mr-2 h-4 w-4" />
              Carregar status
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando dados de saúde...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-red-500" />
        <p className="text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={loadData}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!data) return null;

  // Group history by provider:model
  const historyByProvider: Record<string, ProviderHealthHistoryEntry[]> = {};
  for (const entry of history) {
    const key = `${entry.provider}:${entry.model}`;
    if (!historyByProvider[key]) historyByProvider[key] = [];
    historyByProvider[key].push(entry);
  }

  // Compute uptime per provider (last 24h from history)
  const uptimeByProvider: Record<string, number> = {};
  for (const [key, entries] of Object.entries(historyByProvider)) {
    const total = entries.length;
    const up = entries.filter((e) => e.status !== "down").length;
    uptimeByProvider[key] = total > 0 ? (up / total) * 100 : 100;
  }

  return (
    <div className="space-y-4">
      {/* Human-only mode alert */}
      {data.humanOnlyMode && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950">
          <CardContent className="flex items-center gap-3 py-4">
            <XCircle className="h-5 w-5 text-red-500 shrink-0" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">
                🔴 IA Offline — modo somente humano ativado
              </p>
              {data.pendingRecoveryCount > 0 && (
                <p className="text-sm text-red-600 dark:text-red-300">
                  {data.pendingRecoveryCount} ticket(s) aguardando processamento
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status atual */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HeartPulse className="h-5 w-5" />
                Status dos Providers
              </CardTitle>
              <CardDescription>
                Health check automático a cada 2 minutos
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="health-check-toggle"
                  checked={data.healthCheckEnabled}
                  onCheckedChange={handleToggleHealthCheck}
                  disabled={saving}
                />
                <Label htmlFor="health-check-toggle" className="text-xs">
                  Health check
                </Label>
              </div>
              <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {data.statuses.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum provider configurado ou verificado ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {data.statuses.map((s) => {
                const key = `${s.provider}:${s.model}`;
                const providerHistory = historyByProvider[key] || [];
                const uptime = uptimeByProvider[key] ?? 100;

                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      {statusIcon(s.status)}
                      <div>
                        <p className="font-medium text-sm capitalize">{s.provider}</p>
                        <p className="text-xs text-muted-foreground font-mono">{s.model}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Latency sparkline */}
                      <div className="hidden sm:block w-24">
                        <LatencyBar entries={providerHistory} />
                      </div>

                      {/* Uptime */}
                      <div className="text-right hidden md:block">
                        <p className="text-xs text-muted-foreground">Uptime 24h</p>
                        <p className={`text-sm font-mono ${uptime >= 99 ? "text-green-600" : uptime >= 95 ? "text-yellow-600" : "text-red-600"}`}>
                          {uptime.toFixed(1)}%
                        </p>
                      </div>

                      {/* Latency */}
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Latência</p>
                        <p className="text-sm font-mono">
                          {s.latencyMs ? `${(s.latencyMs / 1000).toFixed(1)}s` : "—"}
                        </p>
                      </div>

                      {/* Status badge */}
                      {statusBadge(s.status)}

                      {/* Time ago */}
                      <span className="text-xs text-muted-foreground w-20 text-right">
                        {formatTimeAgo(s.checkedAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fallback chain */}
      {data.fallbackChain.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5" />
              Fallback Chain
            </CardTitle>
            <CardDescription>
              Ordem de tentativa quando o provider primário falha
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.fallbackChain.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium capitalize">{entry.provider}</p>
                    <p className="text-xs text-muted-foreground font-mono">{entry.model}</p>
                  </div>
                  {i === 0 && (
                    <Badge variant="outline" className="ml-auto">Primário</Badge>
                  )}
                  {i > 0 && i < data.fallbackChain.length - 1 && (
                    <Badge variant="secondary" className="ml-auto">Fallback</Badge>
                  )}
                  {i === data.fallbackChain.length - 1 && i > 0 && (
                    <Badge variant="secondary" className="ml-auto">Último recurso</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Incidentes recentes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5" />
            Incidentes Recentes
          </CardTitle>
          <CardDescription>
            Últimos 30 dias de downtime dos providers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              ✅ Nenhum incidente nos últimos 30 dias.
            </p>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">Data</th>
                    <th className="px-4 py-2 text-left font-medium">Provider</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Duração</th>
                    <th className="px-4 py-2 text-right font-medium">Tickets</th>
                    <th className="px-4 py-2 text-right font-medium">Recuperados</th>
                  </tr>
                </thead>
                <tbody>
                  {data.incidents.map((incident) => (
                    <tr key={incident.id} className="border-b last:border-0">
                      <td className="px-4 py-2 text-xs">
                        {new Date(incident.startedAt).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-2">
                        <span className="capitalize">{incident.provider}</span>
                        <span className="text-xs text-muted-foreground ml-1">
                          ({incident.model})
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {incident.resolvedAt ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Resolvido</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Em andamento</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {incident.resolvedAt
                          ? formatDuration(incident.durationMs)
                          : formatDuration(Date.now() - new Date(incident.startedAt).getTime())}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {incident.ticketsAffected}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {incident.ticketsRecovered}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending recovery */}
      {data.pendingRecoveryCount > 0 && (
        <Card className="border-yellow-500">
          <CardContent className="flex items-center gap-3 py-4">
            <Clock className="h-5 w-5 text-yellow-500 shrink-0" />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">
                {data.pendingRecoveryCount} ticket(s) aguardando reprocessamento
              </p>
              <p className="text-sm text-muted-foreground">
                Serão processados automaticamente quando um provider ficar disponível.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
