"use client";

import { useState } from "react";
import { toast } from "sonner";
import { X, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { AiConfigData } from "./types";

interface TabWhatsAppProps {
  config: AiConfigData;
  setConfig: React.Dispatch<React.SetStateAction<AiConfigData>>;
}

export function TabWhatsApp({ config, setConfig }: TabWhatsAppProps) {
  const [keywordInput, setKeywordInput] = useState("");

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

  return (
    <div className="space-y-4">
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
    </div>
  );
}
