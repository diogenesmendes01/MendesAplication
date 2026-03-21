"use client";

import {
  Save,
  Zap,
  Mail,
  MessageSquare,
  BarChart3,
  Loader2,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/company-context";
import {
  TabGeral,
  TabWhatsApp,
  TabEmail,
  TabConsumo,
  TabSimulador,
} from "./components";
import { useAiConfig } from "./hooks";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AiConfigPage() {
  const { selectedCompanyId } = useCompany();
  const {
    config,
    setConfig,
    loading,
    saving,
    hasUnsavedChanges,
    handleSave,
  } = useAiConfig(selectedCompanyId);

  // ── Guards ────────────────────────────────────────────────────────────────────────
  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para configurar o Agente IA.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agente IA</h1>
          <p className="text-sm text-muted-foreground">
            Configure o atendimento automatizado por inteligência artificial
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="ai-enabled-header"
              checked={config.enabled}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, enabled: checked }))
              }
            />
            <Label htmlFor="ai-enabled-header" className="text-sm font-medium">
              {config.enabled ? "Ativado" : "Desativado"}
            </Label>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="geral" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="geral" className="gap-1.5">
            <Zap className="h-4 w-4" />
            Geral
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5">
            <MessageSquare className="h-4 w-4" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5">
            <Mail className="h-4 w-4" />
            Email
          </TabsTrigger>
          <TabsTrigger value="consumo" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Consumo
          </TabsTrigger>
          <TabsTrigger value="simulador" className="gap-1.5">
            <FlaskConical className="h-4 w-4" />
            Simulador
          </TabsTrigger>
        </TabsList>

        <TabsContent value="geral">
          <TabGeral
            companyId={selectedCompanyId}
            config={config}
            setConfig={setConfig}
            hasUnsavedChanges={hasUnsavedChanges}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="whatsapp">
          <TabWhatsApp config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="email">
          <TabEmail config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="consumo">
          <TabConsumo companyId={selectedCompanyId} config={config} />
        </TabsContent>

        <TabsContent value="simulador">
          <TabSimulador companyId={selectedCompanyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
