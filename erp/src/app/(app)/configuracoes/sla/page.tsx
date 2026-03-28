"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Save, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/company-context";
import { getSlaConfigs, saveSlaConfigs, getBusinessHours, saveBusinessHours, type SlaConfigRow, type BusinessHours } from "./actions";

function minutesToLabel(m: number): string {
  if (m < 60) return `${m}min`;
  if (m % 1440 === 0) return `${m / 1440}d`;
  if (m % 60 === 0) return `${m / 60}h`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

const STAGE_LABELS: Record<string, string> = { first_reply: "1ª Resposta", resolution: "Resolução", approval: "Aprovação", execution: "Execução", total: "Total" };
const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function SlaConfigPage() {
  const { selectedCompanyId } = useCompany();
  const [configs, setConfigs] = useState<SlaConfigRow[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHours>({ enabled: false, startHour: 8, endHour: 18, workDays: [1, 2, 3, 4, 5] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const [slaData, bhData] = await Promise.all([getSlaConfigs(selectedCompanyId), getBusinessHours(selectedCompanyId)]);
      setConfigs(slaData);
      setBusinessHours(bhData);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro ao carregar"); }
    finally { setLoading(false); }
  }, [selectedCompanyId]);

  useEffect(() => { loadData(); }, [loadData]);

  function updateConfig(index: number, field: keyof SlaConfigRow, value: string | boolean | null) {
    setConfigs((prev) => {
      const next = [...prev];
      if (field === "deadlineMinutes" || field === "alertBeforeMinutes") next[index] = { ...next[index], [field]: parseInt(value as string, 10) || 0 };
      else if (field === "autoEscalate" || field === "autoPriorityBump") next[index] = { ...next[index], [field]: value as boolean };
      else if (field === "channelType") next[index] = { ...next[index], channelType: value === "__global__" ? null : (value as SlaConfigRow["channelType"]) };
      else if (field === "priority") next[index] = { ...next[index], priority: value === "__any__" ? null : (value as SlaConfigRow["priority"]) };
      return next;
    });
  }

  function addConfig(type: "TICKET" | "REFUND") {
    setConfigs((prev) => [...prev, { id: null, type, priority: null, stage: "first_reply", channelType: null, deadlineMinutes: 120, alertBeforeMinutes: 30, autoEscalate: true, autoPriorityBump: true, escalateToRole: null }]);
  }

  async function handleSave() {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      const slaInputs = configs.filter((c) => c.stage !== "business_hours").map((c) => ({
        type: c.type, priority: c.priority, stage: c.stage, channelType: c.channelType,
        deadlineMinutes: c.deadlineMinutes, alertBeforeMinutes: c.alertBeforeMinutes,
        autoEscalate: c.autoEscalate, autoPriorityBump: c.autoPriorityBump, escalateToRole: c.escalateToRole,
      }));
      await Promise.all([saveSlaConfigs(selectedCompanyId, slaInputs), saveBusinessHours(selectedCompanyId, businessHours)]);
      toast.success("Configurações de SLA salvas");
      await loadData();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro ao salvar"); }
    finally { setSaving(false); }
  }

  const ticketConfigs = configs.filter((c) => c.type === "TICKET" && c.stage !== "business_hours");
  const refundConfigs = configs.filter((c) => c.type === "REFUND");

  if (!selectedCompanyId) return <div className="flex h-64 items-center justify-center text-muted-foreground">Selecione uma empresa para configurar SLA.</div>;
  if (loading) return <div className="flex h-64 items-center justify-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuração de SLA</h1>
          <p className="text-sm text-muted-foreground">Defina prazos e alertas por canal e prioridade</p>
        </div>
        <Button onClick={handleSave} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Salvando..." : "Salvar"}</Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">SLA de Tickets</CardTitle>
          <Button variant="outline" size="sm" onClick={() => addConfig("TICKET")}><Plus className="mr-1 h-4 w-4" />Adicionar</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Canal</TableHead><TableHead>Prioridade</TableHead><TableHead>Estágio</TableHead>
                <TableHead>Prazo (min)</TableHead><TableHead>Alerta (min)</TableHead>
                <TableHead>Escalar</TableHead><TableHead>Bump</TableHead><TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ticketConfigs.map((c) => {
                const gi = configs.indexOf(c);
                return (
                  <TableRow key={gi}>
                    <TableCell>
                      <Select value={c.channelType ?? "__global__"} onValueChange={(v) => updateConfig(gi, "channelType", v)}>
                        <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__global__">Global</SelectItem>
                          <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                          <SelectItem value="EMAIL">Email</SelectItem>
                          <SelectItem value="RECLAMEAQUI">Reclame Aqui</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={c.priority ?? "__any__"} onValueChange={(v) => updateConfig(gi, "priority", v)}>
                        <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__any__">Todas</SelectItem>
                          <SelectItem value="HIGH">Alta</SelectItem>
                          <SelectItem value="MEDIUM">Média</SelectItem>
                          <SelectItem value="LOW">Baixa</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={c.stage} onValueChange={(v) => { setConfigs((p) => { const n = [...p]; n[gi] = { ...n[gi], stage: v }; return n; }); }}>
                        <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="first_reply">1ª Resposta</SelectItem>
                          <SelectItem value="resolution">Resolução</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Input type="number" className="w-20" value={c.deadlineMinutes} onChange={(e) => updateConfig(gi, "deadlineMinutes", e.target.value)} min={1} />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">({minutesToLabel(c.deadlineMinutes)})</span>
                      </div>
                    </TableCell>
                    <TableCell><Input type="number" className="w-20" value={c.alertBeforeMinutes} onChange={(e) => updateConfig(gi, "alertBeforeMinutes", e.target.value)} min={1} /></TableCell>
                    <TableCell><Checkbox checked={c.autoEscalate} onCheckedChange={(ch) => updateConfig(gi, "autoEscalate", !!ch)} /></TableCell>
                    <TableCell><Checkbox checked={c.autoPriorityBump} onCheckedChange={(ch) => updateConfig(gi, "autoPriorityBump", !!ch)} /></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => setConfigs((p) => p.filter((_, i) => i !== gi))}><Trash2 className="h-4 w-4 text-red-500" /></Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">SLA de Reembolso</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Estágio</TableHead><TableHead>Prazo (min)</TableHead><TableHead>Alerta (min)</TableHead></TableRow></TableHeader>
            <TableBody>
              {refundConfigs.map((c) => {
                const gi = configs.indexOf(c);
                return (
                  <TableRow key={c.stage}>
                    <TableCell className="font-medium">{STAGE_LABELS[c.stage] || c.stage}</TableCell>
                    <TableCell><div className="flex items-center gap-2"><Input type="number" className="w-24" value={c.deadlineMinutes} onChange={(e) => updateConfig(gi, "deadlineMinutes", e.target.value)} min={1} /><span className="text-xs text-muted-foreground">({minutesToLabel(c.deadlineMinutes)})</span></div></TableCell>
                    <TableCell><div className="flex items-center gap-2"><Input type="number" className="w-24" value={c.alertBeforeMinutes} onChange={(e) => updateConfig(gi, "alertBeforeMinutes", e.target.value)} min={1} /><span className="text-xs text-muted-foreground">({minutesToLabel(c.alertBeforeMinutes)})</span></div></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Horário Comercial</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox id="bh-enabled" checked={businessHours.enabled} onCheckedChange={(ch) => setBusinessHours((p) => ({ ...p, enabled: !!ch }))} />
            <label htmlFor="bh-enabled" className="text-sm font-medium">Considerar horário comercial no cálculo de SLA</label>
          </div>
          {businessHours.enabled && (
            <>
              <div className="flex items-center gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Início</label>
                  <Input type="number" className="w-20" value={businessHours.startHour} onChange={(e) => setBusinessHours((p) => ({ ...p, startHour: parseInt(e.target.value, 10) || 0 }))} min={0} max={23} />
                </div>
                <span className="mt-5 text-muted-foreground">às</span>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Fim</label>
                  <Input type="number" className="w-20" value={businessHours.endHour} onChange={(e) => setBusinessHours((p) => ({ ...p, endHour: parseInt(e.target.value, 10) || 0 }))} min={0} max={23} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Dias úteis</label>
                <div className="flex gap-3">
                  {DAY_LABELS.map((label, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Checkbox id={`day-${i}`} checked={businessHours.workDays.includes(i)} onCheckedChange={(ch) => setBusinessHours((p) => ({ ...p, workDays: ch ? [...p.workDays, i].sort() : p.workDays.filter((d) => d !== i) }))} />
                      <label htmlFor={`day-${i}`} className="text-sm">{label}</label>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Opções de Escalação</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox id="gl-esc" checked={ticketConfigs.every((c) => c.autoEscalate)} onCheckedChange={(ch) => { setConfigs((p) => p.map((c) => c.type === "TICKET" && c.stage !== "business_hours" ? { ...c, autoEscalate: !!ch } : c)); }} />
            <label htmlFor="gl-esc" className="text-sm font-medium">Escalação automática quando SLA estoura</label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="gl-bump" checked={ticketConfigs.every((c) => c.autoPriorityBump)} onCheckedChange={(ch) => { setConfigs((p) => p.map((c) => c.type === "TICKET" && c.stage !== "business_hours" ? { ...c, autoPriorityBump: !!ch } : c)); }} />
            <label htmlFor="gl-bump" className="text-sm font-medium">Incrementar prioridade automaticamente no breach</label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
