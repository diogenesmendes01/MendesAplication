"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/contexts/company-context";
import {
  getSlaConfigs,
  saveSlaConfigs,
  getBusinessHours,
  saveBusinessHours,
  type SlaConfigRow,
  type BusinessHours,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minutesToLabel(m: number): string {
  if (m < 60) return `${m}min`;
  if (m < 1440) return `${m / 60}h`;
  return `${m / 1440}d`;
}

const PRIORITY_LABELS: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

const STAGE_LABELS: Record<string, string> = {
  first_reply: "1ª Resposta",
  resolution: "Resolução",
  approval: "Aprovação",
  execution: "Execução",
  total: "Total",
};

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SlaConfigPage() {
  const { selectedCompanyId } = useCompany();
  const [configs, setConfigs] = useState<SlaConfigRow[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHours>({
    enabled: false,
    startHour: 8,
    endHour: 18,
    workDays: [1, 2, 3, 4, 5],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const [slaData, bhData] = await Promise.all([
        getSlaConfigs(selectedCompanyId),
        getBusinessHours(selectedCompanyId),
      ]);
      setConfigs(slaData);
      setBusinessHours(bhData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar configurações");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function updateConfig(index: number, field: "deadlineMinutes" | "alertBeforeMinutes", value: string) {
    setConfigs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: parseInt(value, 10) || 0 };
      return next;
    });
  }

  async function handleSave() {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      const slaInputs = configs
        .filter((c) => c.stage !== "business_hours")
        .map((c) => ({
          type: c.type,
          priority: c.priority,
          stage: c.stage,
          deadlineMinutes: c.deadlineMinutes,
          alertBeforeMinutes: c.alertBeforeMinutes,
        }));

      await Promise.all([
        saveSlaConfigs(selectedCompanyId, slaInputs),
        saveBusinessHours(selectedCompanyId, businessHours),
      ]);

      toast.success("Configurações de SLA salvas com sucesso");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const ticketConfigs = configs.filter((c) => c.type === "TICKET" && c.stage !== "business_hours");
  const refundConfigs = configs.filter((c) => c.type === "REFUND");

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para configurar SLA.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuração de SLA</h1>
          <p className="text-sm text-muted-foreground">
            Defina prazos e alertas por prioridade
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      {/* SLA Tickets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">SLA de Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prioridade</TableHead>
                <TableHead>Estágio</TableHead>
                <TableHead>Prazo (minutos)</TableHead>
                <TableHead>Alerta antes (minutos)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ticketConfigs.map((c) => {
                const globalIdx = configs.indexOf(c);
                return (
                  <TableRow key={`${c.priority}-${c.stage}`}>
                    <TableCell className="font-medium">
                      {c.priority ? PRIORITY_LABELS[c.priority] : "-"}
                    </TableCell>
                    <TableCell>{STAGE_LABELS[c.stage] || c.stage}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          className="w-24"
                          value={c.deadlineMinutes}
                          onChange={(e) => updateConfig(globalIdx, "deadlineMinutes", e.target.value)}
                          min={1}
                        />
                        <span className="text-xs text-muted-foreground">
                          ({minutesToLabel(c.deadlineMinutes)})
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          className="w-24"
                          value={c.alertBeforeMinutes}
                          onChange={(e) => updateConfig(globalIdx, "alertBeforeMinutes", e.target.value)}
                          min={1}
                        />
                        <span className="text-xs text-muted-foreground">
                          ({minutesToLabel(c.alertBeforeMinutes)})
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* SLA Reembolso */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">SLA de Reembolso</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estágio</TableHead>
                <TableHead>Prazo (minutos)</TableHead>
                <TableHead>Alerta antes (minutos)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refundConfigs.map((c) => {
                const globalIdx = configs.indexOf(c);
                return (
                  <TableRow key={c.stage}>
                    <TableCell className="font-medium">
                      {STAGE_LABELS[c.stage] || c.stage}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          className="w-24"
                          value={c.deadlineMinutes}
                          onChange={(e) => updateConfig(globalIdx, "deadlineMinutes", e.target.value)}
                          min={1}
                        />
                        <span className="text-xs text-muted-foreground">
                          ({minutesToLabel(c.deadlineMinutes)})
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          className="w-24"
                          value={c.alertBeforeMinutes}
                          onChange={(e) => updateConfig(globalIdx, "alertBeforeMinutes", e.target.value)}
                          min={1}
                        />
                        <span className="text-xs text-muted-foreground">
                          ({minutesToLabel(c.alertBeforeMinutes)})
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Business Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Horário Comercial</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="bh-enabled"
              checked={businessHours.enabled}
              onCheckedChange={(checked) =>
                setBusinessHours((prev) => ({ ...prev, enabled: !!checked }))
              }
            />
            <label htmlFor="bh-enabled" className="text-sm font-medium">
              Considerar horário comercial no cálculo de SLA
            </label>
          </div>

          {businessHours.enabled && (
            <>
              <div className="flex items-center gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Início
                  </label>
                  <Input
                    type="number"
                    className="w-20"
                    value={businessHours.startHour}
                    onChange={(e) =>
                      setBusinessHours((prev) => ({
                        ...prev,
                        startHour: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                    min={0}
                    max={23}
                  />
                </div>
                <span className="mt-5 text-muted-foreground">às</span>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Fim
                  </label>
                  <Input
                    type="number"
                    className="w-20"
                    value={businessHours.endHour}
                    onChange={(e) =>
                      setBusinessHours((prev) => ({
                        ...prev,
                        endHour: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                    min={0}
                    max={23}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Dias úteis
                </label>
                <div className="flex gap-3">
                  {DAY_LABELS.map((label, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`day-${i}`}
                        checked={businessHours.workDays.includes(i)}
                        onCheckedChange={(checked) =>
                          setBusinessHours((prev) => ({
                            ...prev,
                            workDays: checked
                              ? [...prev.workDays, i].sort()
                              : prev.workDays.filter((d) => d !== i),
                          }))
                        }
                      />
                      <label htmlFor={`day-${i}`} className="text-sm">
                        {label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
