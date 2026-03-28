"use client";

import { Bot, Shield, Zap, AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Badge } from "@/components/ui/badge";
import type { AiConfigData } from "./types";

// ---------------------------------------------------------------------------
// Available tools that can require approval
// ---------------------------------------------------------------------------

const AVAILABLE_TOOLS = [
  { name: "RESPOND", label: "Enviar resposta (WhatsApp)", description: "Responde ao cliente via WhatsApp" },
  { name: "RESPOND_EMAIL", label: "Enviar resposta (Email)", description: "Envia resposta por email" },
  { name: "RESPOND_RECLAMEAQUI", label: "Responder Reclame Aqui", description: "Publica resposta no Reclame Aqui" },
  { name: "ESCALATE", label: "Escalar para humano", description: "Escala o ticket para atendimento humano" },
  { name: "CREATE_NOTE", label: "Criar nota interna", description: "Adiciona nota interna ao ticket" },
  { name: "LINK_TICKET_TO_CLIENT", label: "Vincular ao cliente", description: "Vincula o ticket a um cliente existente" },
] as const;

// ---------------------------------------------------------------------------
// Operation modes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TabSuggestionModeProps {
  config: AiConfigData;
  setConfig: React.Dispatch<React.SetStateAction<AiConfigData>>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TabSuggestionMode({ config, setConfig }: TabSuggestionModeProps) {
  const isHybrid = config.operationMode === "hybrid";
  const isSuggest = config.operationMode === "suggest";

  function handleToggleTool(toolName: string, checked: boolean) {
    setConfig((prev) => ({
      ...prev,
      alwaysRequireApproval: checked
        ? [...prev.alwaysRequireApproval, toolName]
        : prev.alwaysRequireApproval.filter((t) => t !== toolName),
    }));
  }

  return (
    <div className="space-y-6">
      {/* Operation Mode Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-5 w-5 text-purple-600" />
            Modo de Operação
          </CardTitle>
          <CardDescription>
            Define como a IA interage com tickets — executando ações automaticamente
            ou pedindo aprovação humana antes de agir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={config.operationMode}
            onValueChange={(v) =>
              setConfig((prev) => ({ ...prev, operationMode: v }))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione o modo" />
            </SelectTrigger>
            <SelectContent>
              {OPERATION_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  <div className="flex items-center gap-2">
                    {mode.icon}
                    <span>{mode.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Mode cards */}
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
              <div className="text-xs text-yellow-800">
                <strong>Atenção:</strong> No modo automático, a IA executa todas as ações
                sem revisão humana. Recomendado apenas para operações maduras com persona
                bem calibrada e confiança alta.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hybrid Threshold */}
      {isHybrid && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Threshold de Confiança
            </CardTitle>
            <CardDescription>
              Sugestões com confiança abaixo deste threshold serão enviadas para
              aprovação humana. Acima, serão executadas automaticamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Threshold</Label>
                <Badge variant="secondary" className="text-sm font-mono">
                  {Math.round(config.hybridThreshold * 100)}%
                </Badge>
              </div>
              <Slider
                value={[config.hybridThreshold * 100]}
                onValueChange={([v]) =>
                  setConfig((prev) => ({
                    ...prev,
                    hybridThreshold: v / 100,
                  }))
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

            {/* Visual explanation */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-medium">Como funciona:</p>
              <div className="flex items-center gap-2 text-xs">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <span>
                  Confiança &lt; {Math.round(config.hybridThreshold * 100)}% → Pede aprovação humana
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="h-3 w-3 rounded-full bg-green-400" />
                <span>
                  Confiança ≥ {Math.round(config.hybridThreshold * 100)}% → Executa automaticamente
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Always Require Approval */}
      {(isHybrid || config.operationMode === "auto") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5 text-orange-600" />
              Ações que Sempre Pedem Aprovação
            </CardTitle>
            <CardDescription>
              {config.operationMode === "auto"
                ? "Mesmo no modo automático, estas ações sempre passarão por aprovação humana."
                : "Independente do nível de confiança, estas ações sempre pedirão aprovação."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {AVAILABLE_TOOLS.map((tool) => {
              const isChecked = config.alwaysRequireApproval.includes(tool.name);
              return (
                <div
                  key={tool.name}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                    isChecked ? "border-orange-200 bg-orange-50/40" : ""
                  }`}
                >
                  <Checkbox
                    id={`tool-${tool.name}`}
                    checked={isChecked}
                    onCheckedChange={(checked) =>
                      handleToggleTool(tool.name, checked === true)
                    }
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor={`tool-${tool.name}`}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {tool.label}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tool.description}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                    {tool.name}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Mode Summary */}
      {isSuggest && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-800">
                  Modo Sugestão ativo
                </p>
                <p className="text-xs text-blue-700 mt-1">
                  Todas as ações da IA serão enviadas para a fila de sugestões antes de
                  serem executadas. Acesse SAC → Sugestões IA para revisar.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
