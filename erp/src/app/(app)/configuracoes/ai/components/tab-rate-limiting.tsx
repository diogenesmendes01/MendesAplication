"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Shield, Clock, DollarSign, Loader2, TrendingUp, AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRateLimitConfig, updateRateLimitConfig, getTopConsumers, getTopClientConsumers, getRateLimitEvents, type RateLimitConfigData, type TopConsumerData, type TopClientConsumerData, type RateLimitEventData } from "../rate-limit-actions";

interface TabRateLimitingProps { companyId: string; }

export function TabRateLimiting({ companyId }: TabRateLimitingProps) {
  const [config, setConfig] = useState<RateLimitConfigData>({ maxAiInteractionsPerTicketPerHour: 5, aiCooldownSeconds: 30, maxBudgetPerTicketBrl: 2.0, rateLimitAction: "pause" });
  const [originalConfig, setOriginalConfig] = useState<RateLimitConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [topTickets, setTopTickets] = useState<TopConsumerData[]>([]);
  const [topClients, setTopClients] = useState<TopClientConsumerData[]>([]);
  const [events, setEvents] = useState<RateLimitEventData[]>([]);
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const hasUnsavedChanges = originalConfig !== null && JSON.stringify(config) !== JSON.stringify(originalConfig);

  useEffect(() => { if (!companyId) return; let c = false; setLoading(true);
    getRateLimitConfig(companyId).then((d) => { if (!c) { setConfig(d); setOriginalConfig(d); } }).catch(() => toast.error("Erro ao carregar config")).finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [companyId]);

  const loadDashboard = useCallback(async () => { if (!companyId) return; setLoadingDashboard(true);
    try { const [t, cl, ev] = await Promise.all([getTopConsumers(companyId, period), getTopClientConsumers(companyId, period), getRateLimitEvents(companyId)]); setTopTickets(t); setTopClients(cl); setEvents(ev); }
    catch { toast.error("Erro ao carregar dados"); } finally { setLoadingDashboard(false); }
  }, [companyId, period]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  async function handleSave() { setSaving(true); try { await updateRateLimitConfig(companyId, config); setOriginalConfig(config); toast.success("Salvo!"); } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); } finally { setSaving(false); } }

  if (loading) return <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Shield className="h-5 w-5" />Limites por Ticket</CardTitle><CardDescription>Controle o consumo de IA por ticket</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2"><Label className="flex items-center gap-2"><Clock className="h-4 w-4" />Interacoes IA por hora</Label>
            <div className="flex items-center gap-2 max-w-xs"><Input type="number" value={config.maxAiInteractionsPerTicketPerHour} onChange={(e) => setConfig((p) => ({ ...p, maxAiInteractionsPerTicketPerHour: parseInt(e.target.value) || 0 }))} min={0} max={100} className="w-24" /><span className="text-sm text-muted-foreground">(0 = ilimitado)</span></div></div>
          <div className="space-y-2"><Label className="flex items-center gap-2"><Clock className="h-4 w-4" />Cooldown entre respostas</Label>
            <div className="flex items-center gap-2 max-w-xs"><Input type="number" value={config.aiCooldownSeconds} onChange={(e) => setConfig((p) => ({ ...p, aiCooldownSeconds: parseInt(e.target.value) || 0 }))} min={0} max={3600} className="w-24" /><span className="text-sm text-muted-foreground">segundos</span></div></div>
          <div className="space-y-2"><Label className="flex items-center gap-2"><DollarSign className="h-4 w-4" />Budget maximo por ticket</Label>
            <div className="flex items-center gap-2 max-w-xs"><span className="text-sm text-muted-foreground">R$</span><Input type="number" value={config.maxBudgetPerTicketBrl ?? ""} onChange={(e) => { const v = e.target.value; setConfig((p) => ({ ...p, maxBudgetPerTicketBrl: v === "" ? null : parseFloat(v) })); }} placeholder="Sem limite" min={0.01} step={0.5} className="w-32" /></div>
            <p className="text-xs text-muted-foreground">Deixe vazio para nao limitar.</p></div>
          <div className="space-y-2"><Label>Acao quando limite atingido</Label>
            <Select value={config.rateLimitAction} onValueChange={(v) => setConfig((p) => ({ ...p, rateLimitAction: v as "pause" | "escalate" }))}><SelectTrigger className="w-full max-w-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pause">Pausar IA</SelectItem><SelectItem value="escalate">Escalar para humano</SelectItem></SelectContent></Select></div>
          <div className="flex items-center gap-3 pt-2"><Button onClick={handleSave} disabled={saving || !hasUnsavedChanges}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>{hasUnsavedChanges && <span className="text-sm text-amber-600">Alteracoes nao salvas</span>}</div>
        </CardContent></Card>

      <Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle className="flex items-center gap-2 text-lg"><TrendingUp className="h-5 w-5" />Consumo de IA por Ticket</CardTitle><CardDescription>Top tickets e clientes</CardDescription></div>
        <div className="flex items-center gap-2"><Select value={period} onValueChange={(v) => setPeriod(v as "7d" | "30d" | "90d")}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7d">7 dias</SelectItem><SelectItem value="30d">30 dias</SelectItem><SelectItem value="90d">90 dias</SelectItem></SelectContent></Select>
        <Button variant="outline" size="sm" onClick={loadDashboard} disabled={loadingDashboard}>{loadingDashboard ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}</Button></div></div></CardHeader>
        <CardContent className="space-y-6">
          <div><h4 className="text-sm font-medium mb-2 flex items-center gap-2"><TrendingUp className="h-4 w-4" />Top 10 Tickets</h4>
            {topTickets.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">Nenhum dado.</p> :
            <Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Custo</TableHead><TableHead className="text-right">Iteracoes</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{topTickets.map((t) => <TableRow key={t.ticketId}><TableCell className="font-mono text-xs">{t.subject.slice(0, 40)}</TableCell><TableCell>{t.clientName}</TableCell><TableCell className="text-right font-mono">R$ {t.totalCostBrl.toFixed(2)}</TableCell><TableCell className="text-right">{t.interactionCount}</TableCell><TableCell><Badge variant="secondary" className="text-xs">{t.status}</Badge></TableCell></TableRow>)}</TableBody></Table>}</div>
          <div><h4 className="text-sm font-medium mb-2 flex items-center gap-2"><Users className="h-4 w-4" />Top 10 Clientes</h4>
            {topClients.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">Nenhum dado.</p> :
            <Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>CPF/CNPJ</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Custo Total</TableHead></TableRow></TableHeader>
            <TableBody>{topClients.map((c) => <TableRow key={c.clientId}><TableCell>{c.clientName}</TableCell><TableCell className="font-mono text-xs">{c.cpfCnpj}</TableCell><TableCell className="text-right">{c.ticketCount}</TableCell><TableCell className="text-right font-mono">R$ {c.totalCostBrl.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table>}</div>
          <div><h4 className="text-sm font-medium mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Eventos de Rate Limit</h4>
            {events.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">Nenhum evento.</p> :
            <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Ticket</TableHead><TableHead>Tipo</TableHead><TableHead>Detalhes</TableHead></TableRow></TableHeader>
            <TableBody>{events.map((e) => <TableRow key={e.id}><TableCell className="text-xs">{new Date(e.createdAt).toLocaleString("pt-BR")}</TableCell><TableCell className="font-mono text-xs">{e.ticketId.slice(0, 8)}...</TableCell><TableCell><Badge variant={e.type === "budget_exceeded" ? "destructive" : "secondary"} className="text-xs">{e.type === "budget_exceeded" ? "Budget" : e.type === "interaction_limit" ? "Interacoes" : "Cooldown"}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{e.details ? Object.entries(e.details).map(([k, v]) => `${k}: ${v}`).join(", ") : "\u2014"}</TableCell></TableRow>)}</TableBody></Table>}</div>
        </CardContent></Card>
    </div>
  );
}
