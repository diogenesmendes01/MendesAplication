"use client";

import { useState, useEffect } from "react";
import { Lightbulb } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSuggestedModel } from "../actions";
import type { AiConfigData, ModelSuggestionData } from "./types";

// Componentes internos — importados diretamente (não exportados pelo index.ts)
import { TabRateLimiting } from "./tab-rate-limiting";
import { TabConsumo } from "./tab-consumo";
import { TabHealth } from "./tab-health";

// ── Props ─────────────────────────────────────────────────────────────────────

interface TabGestaoProps {
  companyId: string;
  config: AiConfigData;
  setConfig: React.Dispatch<React.SetStateAction<AiConfigData>>;
}

// ── Parâmetros sub-section ────────────────────────────────────────────────────

function ParamsSection({ companyId, config, setConfig }: TabGestaoProps) {
  const [suggestion, setSuggestion] = useState<ModelSuggestionData | null>(null);

  // Load model suggestion when provider or daily limit changes
  useEffect(() => {
    if (!companyId || !config.dailySpendLimitBrl || config.dailySpendLimitBrl <= 0) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    getSuggestedModel(companyId, config.provider, config.dailySpendLimitBrl).then((result) => {
      if (!cancelled) setSuggestion(result);
    });
    return () => { cancelled = true; };
  }, [companyId, config.provider, config.dailySpendLimitBrl]);

  return (
    <div className="space-y-4">
      {/* Temperatura */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Temperatura</CardTitle>
          <CardDescription>
            Controla a criatividade das respostas do modelo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
            0.0 = respostas mais determinísticas · 1.0 = respostas mais criativas
          </p>
        </CardContent>
      </Card>

      {/* Máx. Iterações */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limite de Iterações do Agente</CardTitle>
          <CardDescription>
            Quantas vezes o agente pode usar ferramentas antes de responder (1–10)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Máx. Iterações</Label>
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
          <p className="text-xs text-muted-foreground">
            Valores menores = respostas mais rápidas. Valores maiores = agente mais persistente na busca de informações.
          </p>
        </CardContent>
      </Card>

      {/* Limite de Gasto Diário */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limite de Gasto Diário</CardTitle>
          <CardDescription>
            Quando atingido, o agente para de responder automaticamente até o próximo dia
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Limite diário (R$)</Label>
          <div className="flex items-center gap-2 max-w-xs">
            <span className="text-sm text-muted-foreground">R$</span>
            <Input
              type="number"
              value={config.dailySpendLimitBrl ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setConfig((prev) => ({
                  ...prev,
                  dailySpendLimitBrl: val === "" ? null : parseFloat(val),
                }));
              }}
              placeholder="Sem limite"
              min={0.01}
              step={0.5}
              className={`w-32 ${
                config.dailySpendLimitBrl !== null && config.dailySpendLimitBrl <= 0
                  ? "border-red-500 focus-visible:ring-red-500"
                  : ""
              }`}
            />
          </div>
          {config.dailySpendLimitBrl !== null && config.dailySpendLimitBrl <= 0 && (
            <p className="text-xs text-red-500">
              O limite deve ser um valor positivo (maior que zero).
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Deixe vazio para não limitar.
          </p>

          {/* Model suggestion badge */}
          {suggestion && config.dailySpendLimitBrl && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 mt-2">
              <Lightbulb className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-amber-800">Sugestão:</span>{" "}
                <span className="text-amber-700">
                  Com R${config.dailySpendLimitBrl.toFixed(2)}/dia, recomendamos o modelo{" "}
                  <Badge variant="secondary" className="font-mono text-xs">
                    {suggestion.model}
                  </Badge>{" "}
                  (custo estimado: R${suggestion.estimatedDailyCostBrl.toFixed(2)}/dia)
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TabGestao({ companyId, config, setConfig }: TabGestaoProps) {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="params">
        <TabsList>
          <TabsTrigger value="params">Parâmetros</TabsTrigger>
          <TabsTrigger value="limites">Limites</TabsTrigger>
          <TabsTrigger value="consumo">Consumo</TabsTrigger>
          <TabsTrigger value="saude">Saúde</TabsTrigger>
        </TabsList>

        <TabsContent value="params" className="mt-4">
          <ParamsSection
            companyId={companyId}
            config={config}
            setConfig={setConfig}
          />
        </TabsContent>

        <TabsContent value="limites" className="mt-4">
          <TabRateLimiting companyId={companyId} />
        </TabsContent>

        <TabsContent value="consumo" className="mt-4">
          <TabConsumo companyId={companyId} config={config} />
        </TabsContent>

        <TabsContent value="saude" className="mt-4">
          <TabHealth companyId={companyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
