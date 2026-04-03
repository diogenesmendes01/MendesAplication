"use client";

import { useState } from "react";
import { toast } from "sonner";
import { X, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { AiConfigData } from "./types";

interface TabPersonaProps {
  config: AiConfigData;
  setConfig: React.Dispatch<React.SetStateAction<AiConfigData>>;
}

export function TabPersona({ config, setConfig }: TabPersonaProps) {
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
      {/* Persona Principal */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5" />
            Persona (System Prompt)
          </CardTitle>
          <CardDescription>
            Define a personalidade, tom e instruções do agente. Aplicado em WhatsApp e como padrão para outros canais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.persona}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, persona: e.target.value }))
            }
            placeholder={`Ex: Você é um assistente de suporte da empresa. Seja cordial, objetivo e profissional. Responda em português brasileiro.

Diretrizes:
- Sempre cumprimente o cliente pelo nome, se disponível
- Nunca revele informações internas da empresa
- Escale para um humano em casos de reclamações graves`}
            rows={10}
          />
        </CardContent>
      </Card>

      {/* Mensagem de Boas-vindas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mensagem de Boas-vindas</CardTitle>
          <CardDescription>
            Enviada automaticamente quando um novo ticket é criado (opcional)
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

      {/* Limite de Iterações */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Limite de Iterações do Agente</CardTitle>
          <CardDescription>
            Quantas vezes o agente pode usar ferramentas antes de responder (1-10)
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
          <p className="mt-2 text-xs text-muted-foreground">
            Valores menores = respostas mais rápidas. Valores maiores = agente mais persistente na busca de informações.
          </p>
        </CardContent>
      </Card>

      {/* Palavras-chave de Escalação */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Palavras-chave de Escalação</CardTitle>
          <CardDescription>
            Quando detectadas na mensagem do cliente, o ticket é escalado para um humano
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
          {config.escalationKeywords.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma palavra-chave configurada. O agente responderá todas as mensagens automaticamente.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
