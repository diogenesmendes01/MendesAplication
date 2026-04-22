"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Shield, AlertTriangle, Clock, CheckCircle2, XCircle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/company-context";
import { getSlaDashboard, type SlaDashboardResult } from "./actions";
import { priorityTextColor } from "@/lib/sac/ticket-formatters";

function minutesToHuman(m: number): string {
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min === 0 ? `${h}h` : `${h}h ${min}min`;
}

const PRIORITY_LABELS: Record<string, string> = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };
const STAGE_LABELS: Record<string, string> = { first_reply: "1ª Resposta", resolution: "Resolução" };
const CHANNEL_LABELS: Record<string, string> = { EMAIL: "Email", WHATSAPP: "WhatsApp", RECLAMEAQUI: "Reclame Aqui" };

export default function SlaDashboardPage() {
  const { selectedCompanyId } = useCompany();
  const [data, setData] = useState<SlaDashboardResult | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try { setData(await getSlaDashboard(selectedCompanyId)); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Erro ao carregar dashboard SLA"); }
    finally { setLoading(false); }
  }, [selectedCompanyId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!selectedCompanyId) return <div className="flex h-64 items-center justify-center text-muted-foreground">Selecione uma empresa.</div>;
  if (loading || !data) return <div className="flex h-64 items-center justify-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard SLA</h1>
        <p className="text-sm text-muted-foreground">Compliance e violações em tempo real</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Compliance (30d)</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${data.compliancePercent >= 90 ? "text-green-600" : data.compliancePercent >= 70 ? "text-yellow-600" : "text-red-600"}`}>
              {data.compliancePercent}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Em Risco</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-yellow-600">{data.atRiskCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Violações Ativas</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-red-600">{data.breachedCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Violações Recentes</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.recentViolations.length}</div>
            <p className="text-xs text-muted-foreground">últimas registradas</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-yellow-500" />Tickets em Risco
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.atRiskTickets.length === 0 ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-green-500" />Nenhum ticket em risco.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead><TableHead>Canal</TableHead>
                  <TableHead>Prioridade</TableHead><TableHead>Estágio</TableHead>
                  <TableHead>Tempo Restante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.atRiskTickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium max-w-[250px] truncate">{t.subject}</TableCell>
                    <TableCell><Badge variant="outline">{t.channelType ? CHANNEL_LABELS[t.channelType] ?? t.channelType : "—"}</Badge></TableCell>
                    <TableCell><span className={priorityTextColor(t.priority)}>{PRIORITY_LABELS[t.priority] ?? t.priority}</span></TableCell>
                    <TableCell>{STAGE_LABELS[t.stage] ?? t.stage}</TableCell>
                    <TableCell><Badge variant="outline" className="border-yellow-500 text-yellow-700">⏱️ {minutesToHuman(t.minutesLeft)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <XCircle className="h-5 w-5 text-red-500" />Violações Recentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentViolations.length === 0 ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-green-500" />Nenhuma violação registrada.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead><TableHead>Canal</TableHead>
                  <TableHead>Estágio</TableHead><TableHead>SLA</TableHead>
                  <TableHead>Real</TableHead><TableHead>Quando</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentViolations.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-xs">{v.ticketId.slice(-6)}</TableCell>
                    <TableCell><Badge variant="outline">{CHANNEL_LABELS[v.channel] ?? v.channel}</Badge></TableCell>
                    <TableCell>{STAGE_LABELS[v.stage] ?? v.stage}</TableCell>
                    <TableCell>{minutesToHuman(v.deadlineMinutes)}</TableCell>
                    <TableCell className="text-red-600 font-medium">{minutesToHuman(v.actualMinutes)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(v.breachedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
