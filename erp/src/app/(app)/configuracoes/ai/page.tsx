"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Save,
  Bot,
  X,
  Zap,
  Mail,
  MessageSquare,
  BarChart3,
  Loader2,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Play,
  Send,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/company-context";
import {
  getAiConfig,
  updateAiConfig,
  testAiConnection,
  listAvailableModels,
  getAiUsageSummary,
  getTodaySpendAction,
  getSuggestedModel,
  simulateAiResponse,
  type AiConfigData,
  type UsageSummary,
  type ModelSuggestionData,
  type SimulationResult,
} from "./actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "grok", label: "Grok (xAI)" },
  { value: "qwen", label: "Qwen (Alibaba)" },
  { value: "deepseek", label: "DeepSeek" },
] as const;

const DEFAULT_CONFIG: AiConfigData = {
  enabled: false,
  persona: "",
  welcomeMessage: "",
  escalationKeywords: [],
  maxIterations: 5,
  provider: "openai",
  apiKey: "",
  model: "",
  whatsappEnabled: true,
  emailEnabled: false,
  emailPersona: "",
  emailSignature: "",
  dailySpendLimitBrl: null,
  temperature: 0.7,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AiConfigPage() {
  const { selectedCompanyId } = useCompany();
  const [config, setConfig] = useState<AiConfigData>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<AiConfigData>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // true enquanto há campos alterados ainda não salvos no banco
  const hasUnsavedChanges =
    !loading && JSON.stringify(config) !== JSON.stringify(savedConfig);

  // Provider / Model
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [connectionError, setConnectionError] = useState("");

  // Model suggestion
  const [suggestion, setSuggestion] = useState<ModelSuggestionData | null>(
    null,
  );

  // Keywords
  const [keywordInput, setKeywordInput] = useState("");

  // Consumption tab
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [todaySpend, setTodaySpend] = useState<number>(0);
  const [loadingUsage, setLoadingUsage] = useState(false);

  // Simulator tab
  const [simMessage, setSimMessage] = useState("");
  const [simChannel, setSimChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  // ── Load config ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const data = await getAiConfig(selectedCompanyId);
      setConfig(data);
      setSavedConfig(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar configurações",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Load models when provider changes ─────────────────────────────────────
  const loadModels = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoadingModels(true);
    try {
      const list = await listAvailableModels(selectedCompanyId);
      setModels(list);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!loading && selectedCompanyId) {
      loadModels();
    }
  }, [loading, selectedCompanyId, config.provider, loadModels]);

  // ── Load suggestion when budget or provider changes ───────────────────────
  useEffect(() => {
    if (config.dailySpendLimitBrl && config.dailySpendLimitBrl > 0) {
      getSuggestedModel(config.provider, config.dailySpendLimitBrl).then(
        setSuggestion,
      );
    } else {
      setSuggestion(null);
    }
  }, [config.provider, config.dailySpendLimitBrl]);

  // ── Provider change handler ───────────────────────────────────────────────
  function handleProviderChange(provider: string) {
    setConfig((prev) => ({ ...prev, provider, model: "" }));
    setConnectionStatus("idle");
    setConnectionError("");
  }

  // ── Test connection ───────────────────────────────────────────────────────
  async function handleTestConnection() {
    if (!selectedCompanyId) return;
    setTestingConnection(true);
    setConnectionStatus("idle");
    setConnectionError("");
    try {
      const result = await testAiConnection(selectedCompanyId);
      if (result.ok) {
        setConnectionStatus("success");
        toast.success("Conexão com o provider estabelecida!");
      } else {
        setConnectionStatus("error");
        setConnectionError(result.error ?? "Erro desconhecido");
        toast.error(`Falha na conexão: ${result.error}`);
      }
    } catch (err) {
      setConnectionStatus("error");
      setConnectionError(
        err instanceof Error ? err.message : "Erro desconhecido",
      );
    } finally {
      setTestingConnection(false);
    }
  }

  // ── Keywords ──────────────────────────────────────────────────────────────
  function addKeyword() {
    const keyword = keywordInput.trim().toLowerCase();
    if (!keyword) return;
    if (config.escalationKeywords.includes(keyword)) {
      toast.error("Palavra-chave já adicionada");
      return;
    }
    setConfig((prev) => ({
      ...prev,
      escalationKeywords: [...prev.escalationKeywords, keyword],
    }));
    setKeywordInput("");
  }

  function removeKeyword(keyword: string) {
    setConfig((prev) => ({
      ...prev,
      escalationKeywords: prev.escalationKeywords.filter((k) => k !== keyword),
    }));
  }

  function handleKeywordKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
  }

  // ── Load usage data ───────────────────────────────────────────────────────
  async function loadUsageData() {
    if (!selectedCompanyId) return;
    setLoadingUsage(true);
    try {
      const [summary, spend] = await Promise.all([
        getAiUsageSummary(selectedCompanyId, 30),
        getTodaySpendAction(selectedCompanyId),
      ]);
      setUsageSummary(summary);
      setTodaySpend(spend);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar consumo",
      );
    } finally {
      setLoadingUsage(false);
    }
  }

  // ── Simulate ──────────────────────────────────────────────────────────────
  async function handleSimulate() {
    if (!selectedCompanyId) return;
    if (!simMessage.trim()) {
      toast.error("Digite uma mensagem para simular");
      return;
    }

    setSimRunning(true);
    setSimResult(null);
    try {
      const result = await simulateAiResponse(
        selectedCompanyId,
        simMessage.trim(),
        simChannel,
      );
      setSimResult(result);
      if (result.error) {
        toast.error(`Simulação concluída com erro: ${result.error}`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao executar simulação",
      );
    } finally {
      setSimRunning(false);
    }
  }

  function handleSimKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSimulate();
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      await updateAiConfig(selectedCompanyId, config);
      setSavedConfig(config);
      toast.success("Configurações do Agente IA salvas com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────
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

        {/* ══════════════════════════════════════════════════════════════════
            TAB: Geral
            ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="geral" className="space-y-4">
          {/* Provider + API Key */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Bot className="h-5 w-5" />
                Provider e Autenticação
              </CardTitle>
              <CardDescription>
                Selecione o provider de IA e configure a API key da sua conta
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Provider selector */}
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={config.provider}
                  onValueChange={handleProviderChange}
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue placeholder="Selecione o provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={config.apiKey}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        apiKey: e.target.value,
                      }))
                    }
                    placeholder="sk-..."
                    className="flex-1 max-w-md font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testingConnection || hasUnsavedChanges}
                    title={
                      hasUnsavedChanges
                        ? "Salve as configurações antes de testar a conexão"
                        : undefined
                    }
                  >
                    {testingConnection ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : connectionStatus === "success" ? (
                      <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />
                    ) : connectionStatus === "error" ? (
                      <XCircle className="mr-2 h-4 w-4 text-red-600" />
                    ) : (
                      <Zap className="mr-2 h-4 w-4" />
                    )}
                    Testar Conexão
                  </Button>
                </div>
                {connectionStatus === "success" && (
                  <p className="text-sm text-green-600">
                    ✓ Conexão estabelecida com sucesso
                  </p>
                )}
                {connectionStatus === "error" && connectionError && (
                  <p className="text-sm text-red-600">✗ {connectionError}</p>
                )}
              </div>

              {/* Model */}
              <div className="space-y-2">
                <Label>Modelo</Label>
                <Select
                  value={config.model}
                  onValueChange={(value) =>
                    setConfig((prev) => ({ ...prev, model: value }))
                  }
                  disabled={loadingModels}
                >
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue
                      placeholder={
                        loadingModels
                          ? "Carregando modelos..."
                          : "Selecione o modelo"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {loadingModels && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Carregando modelos disponíveis...
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Temperature + Daily Limit */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Parâmetros</CardTitle>
              <CardDescription>
                Ajuste a criatividade e o limite de gasto diário
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Temperature */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Temperatura</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {config.temperature.toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[config.temperature]}
                  onValueChange={([value]) =>
                    setConfig((prev) => ({ ...prev, temperature: value }))
                  }
                  min={0}
                  max={1}
                  step={0.1}
                  className="max-w-md"
                />
                <p className="text-xs text-muted-foreground">
                  0.0 = respostas mais determinísticas · 1.0 = respostas mais
                  criativas
                </p>
              </div>

              {/* Daily Spend Limit */}
              <div className="space-y-2">
                <Label>Limite de gasto diário (R$)</Label>
                <div className="flex items-center gap-2 max-w-xs">
                  <span className="text-sm text-muted-foreground">R$</span>
                  <Input
                    type="number"
                    value={config.dailySpendLimitBrl ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setConfig((prev) => ({
                        ...prev,
                        dailySpendLimitBrl:
                          val === "" ? null : parseFloat(val),
                      }));
                    }}
                    placeholder="Sem limite"
                    min={0}
                    step={0.5}
                    className="w-32"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Deixe vazio para não limitar. Quando o limite for atingido, o
                  agente para de responder automaticamente.
                </p>
              </div>

              {/* Model suggestion badge */}
              {suggestion && config.dailySpendLimitBrl && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <Lightbulb className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
                  <div className="text-sm">
                    <span className="font-medium text-amber-800">
                      Sugestão:
                    </span>{" "}
                    <span className="text-amber-700">
                      Com R${config.dailySpendLimitBrl.toFixed(2)}/dia,
                      recomendamos o modelo{" "}
                      <Badge variant="secondary" className="font-mono text-xs">
                        {suggestion.model}
                      </Badge>{" "}
                      (custo estimado: R$
                      {suggestion.estimatedDailyCostBrl.toFixed(2)}/dia)
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: WhatsApp
            ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="whatsapp" className="space-y-4">
          {/* Enable toggle */}
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
                    setConfig((prev) => ({
                      ...prev,
                      whatsappEnabled: checked,
                    }))
                  }
                />
                <Label htmlFor="whatsapp-enabled" className="font-medium">
                  {config.whatsappEnabled
                    ? "IA ativa no WhatsApp"
                    : "IA desativada no WhatsApp"}
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Persona */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Persona</CardTitle>
              <CardDescription>
                Defina a personalidade e as instruções do agente IA para
                WhatsApp (system prompt)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={config.persona}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    persona: e.target.value,
                  }))
                }
                placeholder="Ex: Você é um assistente de suporte da empresa. Seja cordial, objetivo e profissional. Responda em português brasileiro."
                rows={6}
              />
            </CardContent>
          </Card>

          {/* Welcome Message */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Mensagem de Boas-vindas</CardTitle>
              <CardDescription>
                Mensagem enviada automaticamente ao cliente quando um novo ticket
                é criado (opcional)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={config.welcomeMessage}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    welcomeMessage: e.target.value,
                  }))
                }
                placeholder="Ex: Olá! Sou o assistente virtual. Como posso ajudá-lo hoje?"
                rows={3}
              />
            </CardContent>
          </Card>

          {/* Escalation Keywords */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Palavras-chave de Escalação
              </CardTitle>
              <CardDescription>
                Quando o cliente enviar uma mensagem com essas palavras, o ticket
                será escalado para um humano
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
              {config.escalationKeywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {config.escalationKeywords.map((keyword) => (
                    <Badge
                      key={keyword}
                      variant="secondary"
                      className="gap-1 pr-1"
                    >
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
            </CardContent>
          </Card>

          {/* Max Iterations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Limite de Iterações</CardTitle>
              <CardDescription>
                Número máximo de vezes que o agente pode usar ferramentas antes
                de responder (1-10)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                type="number"
                value={config.maxIterations}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setConfig((prev) => ({
                      ...prev,
                      maxIterations: Math.min(10, Math.max(1, val)),
                    }));
                  }
                }}
                min={1}
                max={10}
                className="w-24"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: Email
            ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="email" className="space-y-4">
          {/* Enable toggle */}
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
                    setConfig((prev) => ({
                      ...prev,
                      emailEnabled: checked,
                    }))
                  }
                />
                <Label htmlFor="email-enabled" className="font-medium">
                  {config.emailEnabled
                    ? "IA ativa no Email"
                    : "IA desativada no Email"}
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Email Persona */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Persona Email</CardTitle>
              <CardDescription>
                Defina a personalidade do agente para emails. Se deixar vazio,
                herdará a persona do WhatsApp.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={config.emailPersona}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    emailPersona: e.target.value,
                  }))
                }
                placeholder={
                  config.persona
                    ? `Herdado do WhatsApp: "${config.persona.slice(0, 100)}${config.persona.length > 100 ? "..." : ""}"`
                    : "Se vazio, herda a persona do WhatsApp"
                }
                rows={6}
              />
            </CardContent>
          </Card>

          {/* Email Signature */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Assinatura do Email</CardTitle>
              <CardDescription>
                Assinatura adicionada automaticamente ao final de cada resposta
                por email
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={config.emailSignature}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    emailSignature: e.target.value,
                  }))
                }
                placeholder="Ex: Atenciosamente,&#10;Equipe de Suporte&#10;contato@empresa.com"
                rows={4}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: Consumo
            ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="consumo" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <BarChart3 className="h-5 w-5" />
                    Consumo de IA
                  </CardTitle>
                  <CardDescription>
                    Acompanhe o uso e os custos do agente IA nos últimos 30 dias
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadUsageData}
                  disabled={loadingUsage}
                >
                  {loadingUsage ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="mr-2 h-4 w-4" />
                  )}
                  {loadingUsage ? "Carregando..." : "Carregar dados"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!usageSummary && !loadingUsage && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Clique em &quot;Carregar dados&quot; para visualizar o consumo.
                </p>
              )}

              {loadingUsage && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Carregando dados de consumo...
                </div>
              )}

              {usageSummary && !loadingUsage && (
                <div className="space-y-6">
                  {/* Today vs limit */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Gasto hoje
                      </p>
                      <p className="text-2xl font-bold">
                        R$ {todaySpend.toFixed(2)}
                      </p>
                      {config.dailySpendLimitBrl && (
                        <p className="text-xs text-muted-foreground mt-1">
                          de R$ {config.dailySpendLimitBrl.toFixed(2)} (limite)
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Total 30 dias
                      </p>
                      <p className="text-2xl font-bold">
                        R$ {usageSummary.totalCostBrl.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        US$ {usageSummary.totalCostUsd.toFixed(4)}
                      </p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Tokens totais
                      </p>
                      <p className="text-2xl font-bold">
                        {(
                          usageSummary.totalInputTokens +
                          usageSummary.totalOutputTokens
                        ).toLocaleString("pt-BR")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {usageSummary.totalInputTokens.toLocaleString("pt-BR")}{" "}
                        in · {usageSummary.totalOutputTokens.toLocaleString("pt-BR")}{" "}
                        out
                      </p>
                    </div>
                  </div>

                  {/* Breakdown by channel */}
                  {usageSummary.byChannel.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium mb-2">Por canal</h3>
                      <div className="rounded-md border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-4 py-2 text-left font-medium">
                                Canal
                              </th>
                              <th className="px-4 py-2 text-right font-medium">
                                Tokens
                              </th>
                              <th className="px-4 py-2 text-right font-medium">
                                Custo (R$)
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {usageSummary.byChannel.map((ch) => (
                              <tr key={ch.channel} className="border-b last:border-0">
                                <td className="px-4 py-2">
                                  <Badge variant="outline">{ch.channel}</Badge>
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  {ch.totalTokens.toLocaleString("pt-BR")}
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  {ch.costBrl.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Breakdown by model */}
                  {usageSummary.byModel.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium mb-2">Por modelo</h3>
                      <div className="rounded-md border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-4 py-2 text-left font-medium">
                                Modelo
                              </th>
                              <th className="px-4 py-2 text-right font-medium">
                                Tokens
                              </th>
                              <th className="px-4 py-2 text-right font-medium">
                                Custo (R$)
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {usageSummary.byModel.map((m) => (
                              <tr key={m.model} className="border-b last:border-0">
                                <td className="px-4 py-2 font-mono text-xs">
                                  {m.model}
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  {m.totalTokens.toLocaleString("pt-BR")}
                                </td>
                                <td className="px-4 py-2 text-right font-mono">
                                  {m.costBrl.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {usageSummary.byChannel.length === 0 &&
                    usageSummary.byModel.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Nenhum uso registrado nos últimos 30 dias.
                      </p>
                    )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: Simulador
            ══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="simulador" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FlaskConical className="h-5 w-5" />
                Simulador de Resposta IA
              </CardTitle>
              <CardDescription>
                Teste como a IA responderia a uma mensagem usando a persona e
                base de conhecimento atuais. Nenhuma mensagem real é enviada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Channel toggle */}
              <div className="space-y-2">
                <Label>Simular canal</Label>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setSimChannel("WHATSAPP")}
                    className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors ${
                      simChannel === "WHATSAPP"
                        ? "border-green-500 bg-green-50 text-green-700"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <MessageSquare className="h-4 w-4" />
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimChannel("EMAIL")}
                    className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors ${
                      simChannel === "EMAIL"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </button>
                </div>
              </div>

              {/* Message input */}
              <div className="space-y-2">
                <Label>Mensagem do cliente (simulação)</Label>
                <div className="flex gap-2">
                  <Textarea
                    value={simMessage}
                    onChange={(e) => setSimMessage(e.target.value)}
                    onKeyDown={handleSimKeyDown}
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
                  Enter para enviar · Shift+Enter para nova linha · Máx 10 simulações/min
                  {config.dailySpendLimitBrl && (
                    <span className="text-amber-600 font-medium">
                      {' · '}⚠️ Simulações consomem o limite diário (R${config.dailySpendLimitBrl.toFixed(2)}/dia)
                    </span>
                  )}
                </p>
              </div>

              {/* Result area */}
              {simResult && (
                <div className="space-y-3">
                  {/* AI response */}
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="h-4 w-4 text-violet-600" />
                      <span className="text-sm font-medium text-violet-600">
                        Resposta da IA
                      </span>
                      {simResult.error && (
                        <Badge variant="destructive" className="text-xs">
                          {simResult.error}
                        </Badge>
                      )}
                    </div>
                    {simResult.response ? (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {simResult.response}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        Nenhuma resposta gerada
                      </p>
                    )}
                  </div>

                  {/* Usage stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-xs text-muted-foreground">
                        Tokens (input)
                      </p>
                      <p className="text-lg font-bold font-mono">
                        {simResult.inputTokens.toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-xs text-muted-foreground">
                        Tokens (output)
                      </p>
                      <p className="text-lg font-bold font-mono">
                        {simResult.outputTokens.toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <p className="text-xs text-muted-foreground">
                        Custo estimado
                      </p>
                      <p className="text-lg font-bold font-mono">
                        R$ {simResult.estimatedCostBrl.toFixed(4)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!simResult && !simRunning && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-muted-foreground">
                  <Play className="mb-3 h-8 w-8" />
                  <p className="text-sm">
                    Digite uma mensagem e clique em &quot;Simular&quot; para ver
                    como a IA responderia
                  </p>
                  <p className="text-xs mt-1">
                    A simulação usa a persona e base de conhecimento configuradas
                  </p>
                </div>
              )}

              {/* Loading state */}
              {simRunning && (
                <div className="flex items-center justify-center rounded-lg border py-12 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  <span className="text-sm">
                    Processando simulação... A IA está analisando a mensagem com
                    suas configurações
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
