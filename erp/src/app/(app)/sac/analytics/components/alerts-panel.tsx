"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listAlerts,
  upsertAlert,
  toggleAlert,
  deleteAlert,
  METRIC_TYPES,
  type AiAlertRow,
} from "../alert-actions";

interface AlertsPanelProps {
  companyId: string;
}

export function AlertsPanel({ companyId }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<AiAlertRow[]>([]);
  const [isPending, startTransition] = useTransition();

  const [newMetric, setNewMetric] = useState("");
  const [newThreshold, setNewThreshold] = useState("");
  const [newOperator, setNewOperator] = useState("gt");

  useEffect(() => {
    startTransition(async () => {
      const data = await listAlerts(companyId);
      setAlerts(data);
    });
  }, [companyId]);

  const handleAdd = () => {
    if (!newMetric || !newThreshold) return;
    startTransition(async () => {
      await upsertAlert({
        companyId,
        metricType: newMetric,
        threshold: parseFloat(newThreshold),
        operator: newOperator,
      });
      const data = await listAlerts(companyId);
      setAlerts(data);
      setNewMetric("");
      setNewThreshold("");
      setNewOperator("gt");
    });
  };

  const handleToggle = (id: string, enabled: boolean) => {
    startTransition(async () => {
      await toggleAlert(id, enabled);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    });
  };

  const usedMetrics = new Set(alerts.map((a) => a.metricType));
  const availableMetrics = METRIC_TYPES.filter((m) => !usedMetrics.has(m.value));

  const operatorLabel = (op: string) => {
    switch (op) {
      case "gt": return ">";
      case "lt": return "<";
      case "gte": return "≥";
      case "lte": return "≤";
      default: return op;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4" /> Alertas de Observabilidade
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerts.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-2">Nenhum alerta configurado.</p>
        )}
        {alerts.map((alert) => {
          const meta = METRIC_TYPES.find((m) => m.value === alert.metricType);
          return (
            <div key={alert.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Switch checked={alert.enabled} onCheckedChange={(v) => handleToggle(alert.id, v)} />
                <div>
                  <p className="text-sm font-medium">{meta?.label ?? alert.metricType}</p>
                  <p className="text-xs text-muted-foreground">
                    {operatorLabel(alert.operator)} {alert.threshold}
                    {alert.lastTriggeredAt && (
                      <> · Último disparo: {new Date(alert.lastTriggeredAt).toLocaleDateString("pt-BR")}</>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(alert.id)}
                className="text-muted-foreground hover:text-destructive transition-colors"
                disabled={isPending}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}

        {availableMetrics.length > 0 && (
          <div className="flex items-end gap-2 pt-2 border-t">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Métrica</label>
              <Select value={newMetric} onValueChange={setNewMetric}>
                <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  {availableMetrics.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-24">
              <label className="text-xs text-muted-foreground mb-1 block">Operador</label>
              <Select value={newOperator} onValueChange={setNewOperator}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gt">{">"}</SelectItem>
                  <SelectItem value="lt">{"<"}</SelectItem>
                  <SelectItem value="gte">{"≥"}</SelectItem>
                  <SelectItem value="lte">{"≤"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-32">
              <label className="text-xs text-muted-foreground mb-1 block">Valor</label>
              <Input type="number" step="any" placeholder="10.00" value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)} />
            </div>
            <button
              onClick={handleAdd}
              disabled={isPending || !newMetric || !newThreshold}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Adicionar
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
