"use client";

import { useState } from "react";
import { toast } from "sonner";
import { X, MessageSquare, Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import type { AiConfigData } from "./types";

interface TabCanaisProps {
  config: AiConfigData;
  setConfig: React.Dispatch<React.SetStateAction<AiConfigData>>;
}

// ── WhatsApp section ──────────────────────────────────────────────────────────

function SectionWhatsApp({ config, setConfig }: TabCanaisProps) {
  return (
    <div className="space-y-4">
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
          <p className="mt-3 text-xs text-muted-foreground">
            💡 A persona e as palavras-chave de escalação são configuradas na aba <strong>Persona</strong>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Email section ─────────────────────────────────────────────────────────────

function SectionEmail({ config, setConfig }: TabCanaisProps) {
  return (
    <div className="space-y-4">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Persona Email</CardTitle>
          <CardDescription>
            Defina a personalidade do agente para emails. Se deixar vazio, herdará a persona principal (aba Persona).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.emailPersona ?? ""}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, emailPersona: e.target.value }))
            }
            placeholder={
              config.persona
                ? `Herdado da Persona principal: "${config.persona.slice(0, 100)}${config.persona.length > 100 ? "..." : ""}"`
                : "Se vazio, herda a persona principal"
            }
            rows={6}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Assinatura do Email</CardTitle>
          <CardDescription>
            Assinatura adicionada automaticamente ao final de cada resposta por email
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={config.emailSignature ?? ""}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, emailSignature: e.target.value }))
            }
            placeholder={"Ex: Atenciosamente,\nEquipe de Suporte\ncontato@empresa.com"}
            rows={4}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Reclame Aqui section ──────────────────────────────────────────────────────

function SectionReclameAqui({ config, setConfig }: TabCanaisProps) {
  const [keywordInput, setKeywordInput] = useState("");

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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Modo de Operação</CardTitle>
          <CardDescription>
            Defina como a IA deve agir ao receber reclamações no Reclame Aqui
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Resposta Privada Primeiro</CardTitle>
          <CardDescription>
            Quando ativado, a IA envia primeiro uma mensagem privada ao consumidor antes de publicar a resposta pública
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="ra-private-before-public"
              checked={config.raPrivateBeforePublic}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, raPrivateBeforePublic: checked }))
              }
            />
            <Label htmlFor="ra-private-before-public" className="font-medium">
              {config.raPrivateBeforePublic ? "Privada antes da pública" : "Apenas resposta pública"}
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Solicitar Avaliação Automaticamente</CardTitle>
          <CardDescription>
            Quando ativado, a IA solicita automaticamente que o consumidor avalie o atendimento após a resposta pública
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="ra-auto-evaluation"
              checked={config.raAutoRequestEvaluation}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, raAutoRequestEvaluation: checked }))
              }
            />
            <Label htmlFor="ra-auto-evaluation" className="font-medium">
              {config.raAutoRequestEvaluation ? "Solicitação automática ativada" : "Solicitação manual"}
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Palavras-chave de Escalação</CardTitle>
          <CardDescription>
            Quando a reclamação contiver essas palavras, o ticket será escalado para um humano
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
          {config.raEscalationKeywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
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
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TabCanais({ config, setConfig }: TabCanaisProps) {
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
          <SectionWhatsApp config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="email" className="mt-4">
          <SectionEmail config={config} setConfig={setConfig} />
        </TabsContent>

        <TabsContent value="reclameaqui" className="mt-4">
          <SectionReclameAqui config={config} setConfig={setConfig} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
