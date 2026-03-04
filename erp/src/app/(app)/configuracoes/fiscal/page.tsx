"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/company-context";
import {
  getFiscalConfig,
  saveFiscalConfig,
  type FiscalConfigData,
} from "./actions";
import type { TaxRegime } from "@prisma/client";

const REGIME_LABELS: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};

export default function FiscalConfigPage() {
  const { selectedCompanyId } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FiscalConfigData>({
    taxRegime: "SIMPLES_NACIONAL",
    issRate: 5,
    pisRate: 0,
    cofinsRate: 0,
    irpjRate: 0,
    csllRate: 0,
    cnae: "",
    inscricaoMunicipal: "",
    codigoMunicipio: "",
    nfseSerieNumber: "1",
    nfseNextNumber: 1,
    autoEmitNfse: false,
  });

  const loadConfig = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const data = await getFiscalConfig(selectedCompanyId);
      setForm(data);
    } catch {
      toast.error("Erro ao carregar configuração fiscal");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function handleSave() {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      await saveFiscalConfig(selectedCompanyId, form);
      toast.success("Configuração fiscal salva com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function updateField<K extends keyof FiscalConfigData>(
    key: K,
    value: FiscalConfigData[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  if (!selectedCompanyId) {
    return (
      <p className="text-sm text-muted-foreground">
        Selecione uma empresa para configurar.
      </p>
    );
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        Carregando configuração fiscal...
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Configuração Fiscal</h1>
          <p className="text-sm text-muted-foreground">
            Configure alíquotas, dados do prestador e emissão de NFS-e.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      {/* Regime Tributário */}
      <Card>
        <CardHeader>
          <CardTitle>Regime Tributário</CardTitle>
          <CardDescription>
            Define o regime de apuração de impostos da empresa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm">
            <Label htmlFor="taxRegime">Regime</Label>
            <Select
              value={form.taxRegime}
              onValueChange={(v) => updateField("taxRegime", v as TaxRegime)}
            >
              <SelectTrigger id="taxRegime">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REGIME_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Alíquotas */}
      <Card>
        <CardHeader>
          <CardTitle>Alíquotas (%)</CardTitle>
          <CardDescription>
            Percentuais de impostos aplicados na emissão de notas fiscais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                ["issRate", "ISS"],
                ["pisRate", "PIS"],
                ["cofinsRate", "COFINS"],
                ["irpjRate", "IRPJ"],
                ["csllRate", "CSLL"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form[key]}
                  onChange={(e) =>
                    updateField(key, parseFloat(e.target.value) || 0)
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Dados do Prestador */}
      <Card>
        <CardHeader>
          <CardTitle>Dados do Prestador</CardTitle>
          <CardDescription>
            Informações necessárias para integração com a prefeitura.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="cnae">CNAE</Label>
              <Input
                id="cnae"
                value={form.cnae}
                onChange={(e) => updateField("cnae", e.target.value)}
                placeholder="Ex: 6201-5/00"
              />
            </div>
            <div>
              <Label htmlFor="inscricaoMunicipal">Inscrição Municipal</Label>
              <Input
                id="inscricaoMunicipal"
                value={form.inscricaoMunicipal}
                onChange={(e) =>
                  updateField("inscricaoMunicipal", e.target.value)
                }
                placeholder="Ex: 12345678"
              />
            </div>
            <div>
              <Label htmlFor="codigoMunicipio">Código do Município</Label>
              <Input
                id="codigoMunicipio"
                value={form.codigoMunicipio}
                onChange={(e) =>
                  updateField("codigoMunicipio", e.target.value)
                }
                placeholder="Ex: 3550308"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* NFS-e */}
      <Card>
        <CardHeader>
          <CardTitle>NFS-e</CardTitle>
          <CardDescription>
            Configuração de série, numeração e emissão automática.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="nfseSerieNumber">Série</Label>
              <Input
                id="nfseSerieNumber"
                value={form.nfseSerieNumber}
                onChange={(e) =>
                  updateField("nfseSerieNumber", e.target.value)
                }
                placeholder="Ex: A1"
              />
            </div>
            <div>
              <Label htmlFor="nfseNextNumber">Próximo Número</Label>
              <Input
                id="nfseNextNumber"
                type="number"
                min="1"
                value={form.nfseNextNumber}
                onChange={(e) =>
                  updateField("nfseNextNumber", parseInt(e.target.value) || 1)
                }
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Switch
              id="autoEmitNfse"
              checked={form.autoEmitNfse}
              onCheckedChange={(v) => updateField("autoEmitNfse", v)}
            />
            <Label htmlFor="autoEmitNfse" className="cursor-pointer">
              Emitir NFS-e automaticamente ao pagar boleto
            </Label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
