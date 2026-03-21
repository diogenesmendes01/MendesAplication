"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Bot,
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  testAiConnection,
  listAvailableModels,
  getSuggestedModel,
} from "../actions";
import { PROVIDERS, type AiConfigData, type ModelSuggestionData } from "./types";

interface TabGeralProps {
  companyId: string;
  config: AiConfigData;
  setConfig: React.Dispatch<React.SetStateAction<AiConfigData>>;
  hasUnsavedChanges: boolean;
  loading: boolean;
}

export function TabGeral({
  companyId,
  config,
  setConfig,
  hasUnsavedChanges,
  loading,
}: TabGeralProps) {
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [connectionError, setConnectionError] = useState("");
  const [suggestion, setSuggestion] = useState<ModelSuggestionData | null>(null);

  // ── Load models when provider changes ─────────────────────────────────────
  const loadModels = useCallback(async () => {
    if (!companyId) return;
    setLoadingModels(true);
    try {
      const list = await listAvailableModels(companyId, config.provider);
      setModels(list);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, [companyId, config.provider]);

  useEffect(() => {
    if (!loading && companyId) {
      loadModels();
    }
  }, [loading, companyId, config.provider, loadModels]);

  // ── Load suggestion when budget or provider changes ───────────────────────
  useEffect(() => {
    if (companyId && config.dailySpendLimitBrl && config.dailySpendLimitBrl > 0) {
      getSuggestedModel(companyId, config.provider, config.dailySpendLimitBrl).then(
        setSuggestion,
      );
    } else {
      setSuggestion(null);
    }
  }, [companyId, config.provider, config.dailySpendLimitBrl]);

  function handleProviderChange(provider: string) {
    setConfig((prev) => ({ ...prev, provider, model: "" }));
    setConnectionStatus("idle");
    setConnectionError("");
  }

  async function handleTestConnection() {
    if (!companyId) return;
    setTestingConnection(true);
    setConnectionStatus("idle");
    setConnectionError("");
    try {
      const result = await testAiConnection(companyId);
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

  return (
    <div className="space-y-4">
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
                value={config.apiKey ?? ""}
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
            {config.apiKey && /^\*{4}/.test(config.apiKey) && (
              <p className="text-sm text-muted-foreground">
                🔑 Chave configurada. Para alterar, digite uma nova chave.
              </p>
            )}
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
                min={0.01}
                step={0.5}
                className={`w-32 ${config.dailySpendLimitBrl !== null && config.dailySpendLimitBrl <= 0 ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
            </div>
            {config.dailySpendLimitBrl !== null && config.dailySpendLimitBrl <= 0 && (
              <p className="text-xs text-red-500">
                O limite deve ser um valor positivo (maior que zero).
              </p>
            )}
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
    </div>
  );
}
