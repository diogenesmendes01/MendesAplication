"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  X,
  MessageSquare,
  Mail,
  ShieldAlert,
  Bot,
  Zap,
  Shield,
  AlertTriangle,
  Loader2,
  Send,
  Play,
  CheckCircle2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { simulateAiResponse } from "../actions";
import type { AiConfigData, SimulationResult } from "./types";

// ── Operation mode definitions ────────────────────────────────────────────────

const OPERATION_MODES = [
  {
    value: "auto",
    label: "Automático",
    icon: <Zap className="h-4 w-4 text-green-600" />,
    description: "A IA executa ações automaticamente sem revisão humana",
    color: "border-green-200 bg-green-50/40",
  },
  {
    value: "suggest",
    label: "Sugestão",
    icon: <Shield className="h-4 w-4 text-blue-600" />,
    description: "Toda ação passa por aprovação humana antes de ser executada",
    color: "border-blue-200 bg-blue-50/40",
  },
  {
    value: "hybrid",
    label: "Híbrido",
    icon: <Bot className="h-4 w-4 text-purple-600" />,
    description: "Ações com confiança abaixo do threshold pedem aprovação",
    color: "border-purple-200 bg-purple-50/40",
  },
] as const;

// ── Tool lists (UI only — no backend yet) ────────────────────────────────────

const WHATSAPP_TOOLS = [
  "Consultar histórico do cliente",
  "Verificar status de boletos",
  "Emitir 2ª via de boleto automaticamente",
  "Acessar base de conhecimento (RAG)",
  "Criar ticket automaticamente",
];

const EMAIL_TOOLS = [
  "Consultar histórico do cliente",
  "Acessar base de conhecimento (RAG)",
  "Responder com anexos",
];

const RA_TOOLS = [
  "Acessar base de conhecimento (RAG)",
  "Buscar dados do cliente por CNPJ/CPF",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface TabCanaisProps {
  companyId: string;
  config: AiConfigData;
  setConfig: React.Dispatch<React.SetStateAction<AiConfigData>>;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

/**
 * Radio-card selector for operationMode (WhatsApp and Email share config.operationMode).
 * TODO: in the future, each channel will have its own operationMode via channel override.
 */
function OperationModeCard({ config, setConfig }: { config: AiConfigData; setConfig: React.Dispatch<React.SetStateAction<AiConfigData>> }) {
  const isHybrid = config.operationMode === "hybrid";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-600" />
          Modo de Operação
        </CardTitle>
        <CardDescription>
          Define como a IA age neste canal.{" "}
          <span className="text-muted-foreground/70 italic">
            (Global por ora — no futuro cada canal terá seu próprio modo via channel override.)
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Radio cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {OPERATION_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() =>
                setConfig((prev) => ({ ...prev, operationMode: mode.value }))
              }
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                config.operationMode === mode.value
                  ? `${mode.color} ring-2 ring-offset-1 ring-purple-300`
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {mode.icon}
                <span className="text-sm font-semibold">{mode.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{mode.description}</p>
            </button>
          ))}
        </div>

        {config.operationMode === "auto" && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
            <p className="text-xs text-yellow-800">
              <strong>Atenção:</strong> No modo automático, a IA executa todas as ações sem revisão humana. Recomendado apenas para operações maduras com persona bem calibrada.
            </p>
          </div>
        )}

        {/* Hybrid threshold */}
        {isHybrid && (
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Threshold de Confiança</Label>
              <Badge variant="secondary" className="text-sm font-mono">
                {Math.round(config.hybridThreshold * 100)}%
              </Badge>
            </div>
            <Slider
              value={[config.hybridThreshold * 100]}
              onValueChange={([v]) =>
                setConfig((prev) => ({ ...prev, hybridThreshold: v / 100 }))
              }
              min={0}
              max={100}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0% (tudo pede aprovação)</span>
              <span>100% (tudo automático)</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Tool toggle list — UI only, no backend yet.
 * TODO: conectar ao backend quando feature de ferramentas for implementada
 */
function ToolsCard({
  tools,
  toolState,
  setToolState,
}: {
  tools: string[];
  toolState: Record<string, boolean>;
  setToolState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ferramentas do Agente</CardTitle>
        <CardDescription>
          Habilite as ferramentas que o agente pode usar neste canal.{" "}
          <span className="text-muted-foreground/70 italic">
            {/* TODO: conectar ao backend quando feature de ferramentas for implementada */}
            (Interface apenas — configuração persistida em breve.)
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tools.map((tool) => (
          <div key={tool} className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor={`tool-${tool}`} className="text-sm cursor-pointer">
              {tool}
            </Label>
            <Switch
              id={`tool-${tool}`}
              checked={toolState[tool] ?? false}
              onCheckedChange={(checked) =>
                setToolState((prev) => ({ ...prev, [tool]: checked }))
              }
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Inline simulator — reuses simulateAiResponse from actions.ts.
 * Fixed channel per instance.
 */
function ChannelSimulatorCard({
  companyId,
  channel,
}: {
  companyId: string;
  channel: "WHATSAPP" | "EMAIL";
}) {
  const [simMessage, setSimMessage] = useState("");
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  async function handleSimulate() {
    if (!companyId) return;
    if (!simMessage.trim()) {
      toast.error("Digite uma mensagem para simular");
      return;
    }
    setSimRunning(true);
    setSimResult(null);
    try {
      const result = await simulateAiResponse(companyId, simMessage.trim(), channel);
      setSimResult(result);
      if (result.error) {
        toast.error(`Simulação concluída com erro: ${result.error}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao executar simulação");
    } finally {
      setSimRunning(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSimulate();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Simulador</CardTitle>
        <CardDescription>
          Teste como a IA responderia neste canal. Nenhuma mensagem real é enviada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Textarea
            value={simMessage}
            onChange={(e) => setSimMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite uma mensagem como se fosse um cliente..."
            rows={3}
            className="flex-1 resize-none"
            disabled={simRunning}
            maxLength={2000}
          />
          <Button
            onClick={handleSimulate}
            disabled={simRunning || !simMessage.trim()}
            className="self-end"
            size="lg"
          >
            {simRunning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {simRunning ? "Simulando..." : "Simular"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter para enviar · Shift+Enter para nova linha ·{" "}
          <span className="text-green-700 font-medium inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />Simulações não consomem o limite diário real</span>
        </p>

        {simResult && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-violet-600" />
                <span className="text-sm font-medium text-violet-600">Resposta da IA</span>
                {simResult.error && (
                  <Badge variant="destructive" className="text-xs">{simResult.error}</Badge>
                )}
              </div>
              {simResult.response ? (
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{simResult.response}</div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Nenhuma resposta gerada</p>
              )}
              {simResult.simulationWarning && (
                <p className="text-xs text-muted-foreground mt-2 border border-green-200 bg-green-50 rounded px-2 py-1">
                  <span className="inline-flex items-center gap-1"><Info className="h-4 w-4 shrink-0" />{simResult.simulationWarning}</span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border p-3 text-center">
                <p className="text-xs text-muted-foreground">Tokens (input)</p>
                <p className="text-lg font-bold font-mono">{simResult.inputTokens.toLocaleString("pt-BR")}</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-xs text-muted-foreground">Tokens (output)</p>
                <p className="text-lg font-bold font-mono">{simResult.outputTokens.toLocaleString("pt-BR")}</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-xs text-muted-foreground">Custo estimado</p>
                <p className="text-lg font-bold font-mono">R$ {simResult.estimatedCostBrl.toFixed(4)}</p>
              </div>
            </div>
          </div>
        )}

        {!simResult && !simRunning && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-muted-foreground">
            <Play className="mb-2 h-6 w-6" />
            <p className="text-sm">Digite uma mensagem e clique em &quot;Simular&quot;</p>
          </div>
        )}

        {simRunning && (
          <div className="flex items-center justify-center rounded-lg border py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            <span className="text-sm">Processando simulação...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── WhatsApp section ──────────────────────────────────────────────────────────

function SectionWhatsApp({ companyId, config, setConfig }: TabCanaisProps) {
  // TODO: conectar ao backend quando feature de ferramentas for implementada
  const [whatsappTools, setWhatsappTools] = useState<Record<string, boolean>>(
    Object.fromEntries(WHATSAPP_TOOLS.map((t) => [t, false])),
  );

  return (
    <div className="space-y-4">
      {/* Card 1: Enable toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5" />
            WhatsApp
          </CardTitle>
          <CardDescription>
            Configure o agente IA para atendimento via WhatsApp
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="whatsapp-enabled"
              checked={config.whatsappEnabled}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, whatsappEnabled: checked }))
              }
            />
            <Label htmlFor="whatsapp-enabled" className="font-medium">
              {config.whatsappEnabled ? "IA ativa no WhatsApp" : "IA desativada no WhatsApp"}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Persona do Canal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Persona do Canal</CardTitle>
          <CardDescription>
            Sobrescreve a persona principal apenas neste canal. Se vazio, herda a persona da aba Persona.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.persona}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, persona: e.target.value }))
            }
            placeholder={
              "Se vazio, herda a persona principal (aba Persona).\n\nEx: Você é um assistente de suporte via WhatsApp. Use linguagem informal e emojis moderados. Seja objetivo nas respostas."
            }
            rows={6}
          />
        </CardContent>
      </Card>

      {/* Card 3: Boas-vindas — Exclusivo WhatsApp */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mensagem de Boas-vindas</CardTitle>
          <CardDescription>
            Enviada automaticamente quando um novo ticket é criado via WhatsApp.{" "}
            <Badge variant="outline" className="text-xs">Exclusivo WhatsApp</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.welcomeMessage}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, welcomeMessage: e.target.value }))
            }
            placeholder="Ex: Olá! Sou o assistente virtual. Como posso ajudá-lo hoje?"
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Card 4: Modo de Operação */}
      {/* WhatsApp usa config.operationMode (global por ora) */}
      <OperationModeCard config={config} setConfig={setConfig} />

      {/* Card 5: Ferramentas do Agente */}
      <ToolsCard
        tools={WHATSAPP_TOOLS}
        toolState={whatsappTools}
        setToolState={setWhatsappTools}
      />

      {/* Card 6: Simulador */}
      <ChannelSimulatorCard companyId={companyId} channel="WHATSAPP" />
    </div>
  );
}

// ── Email section ─────────────────────────────────────────────────────────────

function SectionEmail({ companyId, config, setConfig }: TabCanaisProps) {
  // TODO: conectar ao backend quando feature de ferramentas for implementada
  const [emailTools, setEmailTools] = useState<Record<string, boolean>>(
    Object.fromEntries(EMAIL_TOOLS.map((t) => [t, false])),
  );

  return (
    <div className="space-y-4">
      {/* Card 1: Enable toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5" />
            Email
          </CardTitle>
          <CardDescription>
            Configure o agente IA para atendimento via email
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="email-enabled"
              checked={config.emailEnabled}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, emailEnabled: checked }))
              }
            />
            <Label htmlFor="email-enabled" className="font-medium">
              {config.emailEnabled ? "IA ativa no Email" : "IA desativada no Email"}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Persona Email */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Persona Email</CardTitle>
          <CardDescription>
            Sobrescreve a persona principal apenas neste canal. Se vazio, herda a persona da aba Persona.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.emailPersona ?? ""}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, emailPersona: e.target.value || null }))
            }
            placeholder={
              config.persona
                ? `Herdado da Persona principal: "${config.persona.slice(0, 100)}${config.persona.length > 100 ? "..." : ""}"`
                : "Se vazio, herda a persona principal (aba Persona)"
            }
            rows={6}
          />
        </CardContent>
      </Card>

      {/* Card 3: Assinatura */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assinatura do Email</CardTitle>
          <CardDescription>
            Adicionada automaticamente ao final de cada resposta por email
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.emailSignature ?? ""}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, emailSignature: e.target.value || null }))
            }
            placeholder={"Ex: Atenciosamente,\nEquipe de Suporte\ncontato@empresa.com"}
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Card 4: Modo de Operação */}
      {/* Email usa config.operationMode (global por ora) */}
      <OperationModeCard config={config} setConfig={setConfig} />

      {/* Card 5: Ferramentas */}
      <ToolsCard
        tools={EMAIL_TOOLS}
        toolState={emailTools}
        setToolState={setEmailTools}
      />

      {/* Card 6: Simulador */}
      <ChannelSimulatorCard companyId={companyId} channel="EMAIL" />
    </div>
  );
}

// ── Reclame Aqui section ──────────────────────────────────────────────────────

function SectionReclameAqui({ companyId, config, setConfig }: TabCanaisProps) {
  const [keywordInput, setKeywordInput] = useState("");
  // TODO: conectar ao backend quando feature de ferramentas for implementada
  const [raTools, setRaTools] = useState<Record<string, boolean>>(
    Object.fromEntries(RA_TOOLS.map((t) => [t, false])),
  );

  function addKeyword() {
    const keyword = keywordInput.trim().toLowerCase();
    if (!keyword) return;
    if (config.raEscalationKeywords.includes(keyword)) {
      toast.error("Palavra-chave já adicionada");
      return;
    }
    setConfig((prev) => ({
      ...prev,
      raEscalationKeywords: [...prev.raEscalationKeywords, keyword],
    }));
    setKeywordInput("");
  }

  function removeKeyword(keyword: string) {
    setConfig((prev) => ({
      ...prev,
      raEscalationKeywords: prev.raEscalationKeywords.filter((k) => k !== keyword),
    }));
  }

  function handleKeywordKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
  }

  return (
    <div className="space-y-4">
      {/* Card 1: Enable toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="h-5 w-5" />
            Reclame Aqui
          </CardTitle>
          <CardDescription>
            Configure o agente IA para atendimento via Reclame Aqui
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="ra-enabled"
              checked={config.raEnabled}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, raEnabled: checked }))
              }
            />
            <Label htmlFor="ra-enabled" className="font-medium">
              {config.raEnabled ? "IA ativa no Reclame Aqui" : "IA desativada no Reclame Aqui"}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Persona RA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Persona Reclame Aqui</CardTitle>
          <CardDescription>
            Sobrescreve a persona principal neste canal. Usa o campo emailPersona como override — se vazio, herda a persona principal.
            {/* TODO: no futuro, usar campo raPersona dedicado quando disponível */}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.emailPersona ?? ""}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, emailPersona: e.target.value || null }))
            }
            placeholder="Ex: Você é um especialista em resolução de reclamações. Seja empático, direto e sempre ofereça uma solução concreta. Lembre-se que a conversa é pública e afeta a reputação da empresa."
            rows={6}
          />
          <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-4 w-4 shrink-0" />Campo compartilhado com persona Email enquanto campo dedicado RA não está disponível.
          </p>
        </CardContent>
      </Card>

      {/* Card 3: Modo de Operação RA */}
      {/* RA usa config.raMode (separado de operationMode) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-5 w-5 text-purple-600" />
            Modo de Operação
          </CardTitle>
          <CardDescription>
            Define como a IA age nas reclamações do Reclame Aqui
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={config.raMode}
            onValueChange={(v) => setConfig((prev) => ({ ...prev, raMode: v }))}
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="suggest">Sugerir e aguardar aprovação</SelectItem>
              <SelectItem value="auto">Responder automaticamente</SelectItem>
              <SelectItem value="off">IA desligada</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Card 4: Configurações RA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configurações Reclame Aqui</CardTitle>
          <CardDescription>
            Ajuste o comportamento do agente nas interações do Reclame Aqui
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* raPrivateBeforePublic */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="ra-private-before-public" className="font-medium">
                Resposta privada antes da pública
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Envia uma mensagem privada ao consumidor antes de publicar a resposta pública
              </p>
            </div>
            <Switch
              id="ra-private-before-public"
              checked={config.raPrivateBeforePublic}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, raPrivateBeforePublic: checked }))
              }
            />
          </div>

          {/* raAutoRequestEvaluation */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="ra-auto-evaluation" className="font-medium">
                Solicitar avaliação automaticamente
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Solicita automaticamente que o consumidor avalie o atendimento após a resposta pública
              </p>
            </div>
            <Switch
              id="ra-auto-evaluation"
              checked={config.raAutoRequestEvaluation}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, raAutoRequestEvaluation: checked }))
              }
            />
          </div>

          {/* raEscalationKeywords */}
          <div className="space-y-2">
            <Label>Palavras-chave de Escalação</Label>
            <p className="text-xs text-muted-foreground">
              Quando a reclamação contiver essas palavras, o ticket será escalado para um humano
            </p>
            <div className="flex gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={handleKeywordKeyDown}
                placeholder="Digite uma palavra-chave e pressione Enter"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={addKeyword}>
                Adicionar
              </Button>
            </div>
            {config.raEscalationKeywords.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {config.raEscalationKeywords.map((keyword) => (
                  <Badge key={keyword} variant="secondary" className="gap-1 pr-1">
                    {keyword}
                    <button
                      type="button"
                      onClick={() => removeKeyword(keyword)}
                      className="ml-1 rounded-full p-0.5 hover:bg-muted"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Card 5: Ferramentas */}
      <ToolsCard
        tools={RA_TOOLS}
        toolState={raTools}
        setToolState={setRaTools}
      />

      {/* Card 6: Simulador — RA não tem canal separado, usar WHATSAPP como fallback */}
      <ChannelSimulatorCard companyId={companyId} channel="WHATSAPP" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TabCanais({ companyId, config, setConfig }: TabCanaisProps) {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="whatsapp">
        <TabsList>
          <TabsTrigger value="whatsapp" className="gap-1.5">
            <MessageSquare className="h-4 w-4" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5">
            <Mail className="h-4 w-4" />
            Email
          </TabsTrigger>
          <TabsTrigger value="reclameaqui" className="gap-1.5">
            <ShieldAlert className="h-4 w-4" />
            Reclame Aqui
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="mt-4">
          <SectionWhatsApp companyId={companyId} config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="email" className="mt-4">
          <SectionEmail companyId={companyId} config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="reclameaqui" className="mt-4">
          <SectionReclameAqui companyId={companyId} config={config} setConfig={setConfig} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
