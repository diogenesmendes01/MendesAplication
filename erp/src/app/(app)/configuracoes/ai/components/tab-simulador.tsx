"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Mail,
  MessageSquare,
  Loader2,
  Play,
  Send,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { simulateAiResponse } from "../actions";
import type { SimulationResult } from "./types";

interface TabSimuladorProps {
  companyId: string;
}

export function TabSimulador({ companyId }: TabSimuladorProps) {
  const [simMessage, setSimMessage] = useState("");
  const [simChannel, setSimChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
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
      const result = await simulateAiResponse(
        companyId,
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

  return (
    <div className="space-y-4">
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
              <span className="text-green-700 font-medium">
                {" · "}✅ Simulações não consomem o limite diário real
              </span>
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
                {simResult.simulationWarning && (
                  <p className="text-xs text-muted-foreground mt-2 border border-green-200 bg-green-50 rounded px-2 py-1">
                    ℹ️ {simResult.simulationWarning}
                  </p>
                )}
              </div>

              {/* Usage stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground">Tokens (input)</p>
                  <p className="text-lg font-bold font-mono">
                    {simResult.inputTokens.toLocaleString("pt-BR")}
                  </p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground">Tokens (output)</p>
                  <p className="text-lg font-bold font-mono">
                    {simResult.outputTokens.toLocaleString("pt-BR")}
                  </p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground">Custo estimado</p>
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
    </div>
  );
}
