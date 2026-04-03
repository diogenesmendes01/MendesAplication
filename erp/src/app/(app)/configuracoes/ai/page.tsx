"use client";

import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/company-context";
import { TabGeral, TabPersona, TabCanais, TabGestao } from "./components";
import { useAiConfig } from "./hooks";

export default function AiConfigPage() {
  const { selectedCompanyId } = useCompany();

  const {
    config,
    setConfig,
    savedConfig,
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

      {/* 4-tab structure: Configuração · Persona · Canais · Gestão */}
      <Tabs defaultValue="configuracao" className="space-y-4">
        <TabsList>
          <TabsTrigger value="configuracao">⚙️ Configuração</TabsTrigger>
          <TabsTrigger value="persona">🤖 Persona</TabsTrigger>
          <TabsTrigger value="canais">📡 Canais</TabsTrigger>
          <TabsTrigger value="gestao">📊 Gestão</TabsTrigger>
        </TabsList>

        <TabsContent value="configuracao">
          <TabGeral
            companyId={selectedCompanyId}
            config={config}
            setConfig={setConfig}
            savedConfig={savedConfig}
            hasUnsavedChanges={hasUnsavedChanges}
            loading={loading}
          />
        </TabsContent>

        <TabsContent value="persona">
          <TabPersona config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="canais">
          <TabCanais
            companyId={selectedCompanyId}
            config={config}
            setConfig={setConfig}
          />
        </TabsContent>

        <TabsContent value="gestao">
          <TabGestao
            companyId={selectedCompanyId}
            config={config}
            setConfig={setConfig}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
