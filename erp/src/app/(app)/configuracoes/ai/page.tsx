"use client";


import {
  Save,
  Shield,
  BarChart3,
  Loader2,
  FlaskConical,
  Lightbulb,
  Settings2,
  Bot,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/company-context";
import {
  TabGeral,
  TabPersona,
  TabCanais,
  TabFerramentas,
  TabConsumo,
  TabSuggestionMode,
  TabRateLimiting,
} from "./components";
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

      {/* Single flat tab bar — 7 sections */}
      <Tabs defaultValue="configuracao" className="space-y-4">
        <TabsList className="flex w-full overflow-x-auto scrollbar-hide">
          <TabsTrigger value="configuracao" className="gap-1.5">
            <Settings2 className="h-4 w-4" />
            Configuração
          </TabsTrigger>
          <TabsTrigger value="persona" className="gap-1.5">
            <Bot className="h-4 w-4" />
            Persona
          </TabsTrigger>
          <TabsTrigger value="canais" className="gap-1.5">
            <Layers className="h-4 w-4" />
            Canais
          </TabsTrigger>
          <TabsTrigger value="operacao" className="gap-1.5">
            <Lightbulb className="h-4 w-4" />
            Operação
          </TabsTrigger>
          <TabsTrigger value="limites" className="gap-1.5">
            <Shield className="h-4 w-4" />
            Limites
          </TabsTrigger>
          <TabsTrigger value="ferramentas" className="gap-1.5">
            <FlaskConical className="h-4 w-4" />
            Simulador & Saúde
          </TabsTrigger>
          <TabsTrigger value="consumo" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Consumo
          </TabsTrigger>
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
          <TabCanais config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="operacao">
          <TabSuggestionMode config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="limites">
          <TabRateLimiting companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="ferramentas">
          <TabFerramentas companyId={selectedCompanyId} config={config} />
        </TabsContent>

        <TabsContent value="consumo">
          <TabConsumo companyId={selectedCompanyId} config={config} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
