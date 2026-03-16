"use client";

import { Mail } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { AiConfigData } from "./types";

interface TabEmailProps {
  config: AiConfigData;
  setConfig: React.Dispatch<React.SetStateAction<AiConfigData>>;
}

export function TabEmail({ config, setConfig }: TabEmailProps) {
  return (
    <div className="space-y-4">
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
            value={config.emailPersona ?? ""}
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
            value={config.emailSignature ?? ""}
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
    </div>
  );
}
