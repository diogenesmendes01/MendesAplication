"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Save, Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useCompany } from "@/contexts/company-context";
import { getAiConfig, updateAiConfig, type AiConfigData } from "./actions";

const DEFAULT_CONFIG: AiConfigData = {
  enabled: false,
  persona: "",
  welcomeMessage: "",
  escalationKeywords: [],
  maxIterations: 5,
};

export default function AiConfigPage() {
  const { selectedCompanyId } = useCompany();
  const [config, setConfig] = useState<AiConfigData>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const data = await getAiConfig(selectedCompanyId);
      setConfig(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar configurações");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  async function handleSave() {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      await updateAiConfig(selectedCompanyId, config);
      toast.success("Configurações do Agente IA salvas com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

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
        Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agente IA</h1>
          <p className="text-sm text-muted-foreground">
            Configure o atendimento automatizado por inteligência artificial
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      {/* Enable/Disable */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5" />
            Status do Agente
          </CardTitle>
          <CardDescription>
            Ative ou desative o agente IA para todos os tickets desta empresa
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="ai-enabled"
              checked={config.enabled}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, enabled: checked }))
              }
            />
            <Label htmlFor="ai-enabled" className="font-medium">
              {config.enabled ? "Agente IA ativado" : "Agente IA desativado"}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Persona */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Persona</CardTitle>
          <CardDescription>
            Defina a personalidade e as instruções do agente IA (system prompt)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.persona}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, persona: e.target.value }))
            }
            placeholder="Ex: Você é um assistente de suporte da empresa Mendes Tech. Seja cordial, objetivo e profissional. Responda em português brasileiro. Se não souber a resposta, consulte a base de conhecimento antes de escalar para um humano."
            rows={6}
          />
        </CardContent>
      </Card>

      {/* Welcome Message */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mensagem de Boas-vindas</CardTitle>
          <CardDescription>
            Mensagem enviada automaticamente ao cliente quando um novo ticket é criado (opcional)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.welcomeMessage}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, welcomeMessage: e.target.value }))
            }
            placeholder="Ex: Olá! Sou o assistente virtual da Mendes Tech. Como posso ajudá-lo hoje?"
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Escalation Keywords */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Palavras-chave de Escalação</CardTitle>
          <CardDescription>
            Quando o cliente enviar uma mensagem contendo uma dessas palavras, o ticket será escalado automaticamente para um atendente humano sem passar pelo agente IA
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
        </CardContent>
      </Card>

      {/* Max Iterations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Limite de Iterações</CardTitle>
          <CardDescription>
            Número máximo de vezes que o agente IA pode usar ferramentas antes de dar uma resposta final (1-10)
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
