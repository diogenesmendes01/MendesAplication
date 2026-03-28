"use client";

import { useState } from "react";
import {
  Save,
  Zap,
  Mail,
  MessageSquare,
  BarChart3,
  Loader2,
  FlaskConical,
  ShieldAlert,
  Globe,
  Lightbulb,
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
  TabReclameAqui,
  TabSuggestionMode,
} from "./components";
import { useAiConfig } from "./hooks";
import type { ChannelType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Channel tab definitions
// ---------------------------------------------------------------------------

type ChannelTab = {
  id: string;
  label: string;
  icon: React.ReactNode;
  channel: ChannelType | null;
};

const CHANNEL_TABS: ChannelTab[] = [
  { id: "global", label: "Geral", icon: <Globe className="h-4 w-4" />, channel: null },
  { id: "whatsapp", label: "WhatsApp", icon: <MessageSquare className="h-4 w-4" />, channel: "WHATSAPP" },
  { id: "email", label: "Email", icon: <Mail className="h-4 w-4" />, channel: "EMAIL" },
  { id: "reclameaqui", label: "Reclame Aqui", icon: <ShieldAlert className="h-4 w-4" />, channel: "RECLAMEAQUI" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AiConfigPage() {
  const { selectedCompanyId } = useCompany();
  const [activeChannelTab, setActiveChannelTab] = useState("global");

  // Resolve the channel for the active tab
  const activeChannel = CHANNEL_TABS.find((t) => t.id === activeChannelTab)?.channel ?? null;

  const {
    config,
    setConfig,
    loading,
    saving,
    hasUnsavedChanges,
    handleSave,
  } = useAiConfig(selectedCompanyId, activeChannel);

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

      {/* Channel Tabs — top-level selector for per-channel config */}
      <Tabs value={activeChannelTab} onValueChange={setActiveChannelTab} className="space-y-4">
        <TabsList>
          {CHANNEL_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {activeChannel === null && (
          <p className="text-xs text-muted-foreground">
            Configuração padrão aplicada a todos os canais sem configuração específica.
          </p>
        )}
        {activeChannel !== null && (
          <p className="text-xs text-muted-foreground">
            Configuração específica para o canal <strong>{CHANNEL_TABS.find((t) => t.channel === activeChannel)?.label}</strong>.
            Campos não preenchidos herdam da configuração Geral.
          </p>
        )}
      </Tabs>

      {/* Config Tabs — sections within the active channel config */}
      <Tabs defaultValue="geral" className="space-y-4">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="geral" className="gap-1.5">
            <Zap className="h-4 w-4" />
            Geral
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5">
            <MessageSquare className="h-4 w-4" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="reclameaqui" className="gap-1.5">
            <ShieldAlert className="h-4 w-4" />
            Reclame Aqui
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
          <TabsTrigger value="suggestion-mode" className="gap-1.5">
            <Lightbulb className="h-4 w-4" />
            Modo Sugestão
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

        <TabsContent value="reclameaqui">
          <TabReclameAqui config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="consumo">
          <TabConsumo companyId={selectedCompanyId} config={config} />
        </TabsContent>

        <TabsContent value="simulador">
          <TabSimulador companyId={selectedCompanyId} />
        </TabsContent>

        <TabsContent value="suggestion-mode">
          <TabSuggestionMode config={config} setConfig={setConfig} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
