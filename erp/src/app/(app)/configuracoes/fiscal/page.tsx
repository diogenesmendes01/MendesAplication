"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Save, Upload, CheckCircle2, KeyRound, Building2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/contexts/company-context";
import {
  getFiscalConfig,
  saveFiscalConfig,
  saveCertificado,
  type FiscalConfigData,
} from "./actions";
import type { TaxRegime } from "@prisma/client";

const REGIME_LABELS: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};

const MUNICIPIOS_CONHECIDOS: Record<string, string> = {
  "3509502": "Campinas - SP",
  "3550308": "São Paulo - SP",
  "3552809": "Taboão da Serra - SP",
};

const USA_TOKENS = "3552809"; // Taboão — CONAM sem certificado

export default function FiscalConfigPage() {
  const { selectedCompanyId } = useCompany();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCert, setSavingCert] = useState(false);
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
    itemListaServico: "",
    codigoTributacaoMunicipio: "",
    certificadoToken1: "",
    certificadoToken2: "",
    hasCertificado: false,
  });

  // Estado local do upload do certificado
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certSenha, setCertSenha] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleSaveCertificado() {
    if (!selectedCompanyId || !certFile || !certSenha) return;
    setSavingCert(true);
    try {
      const arrayBuffer = await certFile.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      await saveCertificado(selectedCompanyId, base64, certSenha);
      toast.success("Certificado digital salvo com sucesso");
      setForm((prev) => ({ ...prev, hasCertificado: true }));
      setCertFile(null);
      setCertSenha("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar certificado");
    } finally {
      setSavingCert(false);
    }
  }

  function updateField<K extends keyof FiscalConfigData>(
    key: K,
    value: FiscalConfigData[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const municipioNome = MUNICIPIOS_CONHECIDOS[form.codigoMunicipio];
  const usaTokens = form.codigoMunicipio === USA_TOKENS;

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
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Dados do Prestador
          </CardTitle>
          <CardDescription>
            Informações necessárias para integração com a prefeitura.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <Label htmlFor="codigoMunicipio">
                Código IBGE do Município
              </Label>
              <Input
                id="codigoMunicipio"
                value={form.codigoMunicipio}
                onChange={(e) =>
                  updateField("codigoMunicipio", e.target.value)
                }
                placeholder="Ex: 3550308"
              />
              {municipioNome && (
                <p className="text-xs text-muted-foreground mt-1">
                  ✓ {municipioNome}
                </p>
              )}
              {form.codigoMunicipio && !municipioNome && (
                <p className="text-xs text-amber-600 mt-1">
                  Município não integrado nativamente
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Campinas: 3509502 · SP: 3550308 · Taboão: 3552809
              </p>
            </div>
          </div>

          {/* Código de Serviço LC116 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="itemListaServico">
                Código de Serviço LC116
              </Label>
              <Input
                id="itemListaServico"
                value={form.itemListaServico}
                onChange={(e) =>
                  updateField("itemListaServico", e.target.value)
                }
                placeholder="Ex: 01.07"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Veja a tabela LC116/2003 — TI geralmente: 01.05 ou 01.07
              </p>
            </div>
            <div>
              <Label htmlFor="codigoTributacaoMunicipio">
                Código de Tributação Municipal{" "}
                <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="codigoTributacaoMunicipio"
                value={form.codigoTributacaoMunicipio}
                onChange={(e) =>
                  updateField("codigoTributacaoMunicipio", e.target.value)
                }
                placeholder="Opcional"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Autenticação NFS-e — condicional por município */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Autenticação NFS-e
            {form.codigoMunicipio && (
              <Badge variant={usaTokens ? "secondary" : "outline"} className="ml-2 text-xs">
                {usaTokens ? "Tokens (CONAM)" : "Certificado A1 (.pfx)"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {usaTokens
              ? "Taboão da Serra usa autenticação por tokens — sem certificado digital."
              : "Campinas e São Paulo exigem Certificado Digital A1 (.pfx) para assinar as notas."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usaTokens ? (
            /* Taboão da Serra — Tokens CONAM */
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="certificadoToken1">Token 1 (Usuário)</Label>
                <Input
                  id="certificadoToken1"
                  value={form.certificadoToken1}
                  onChange={(e) =>
                    updateField("certificadoToken1", e.target.value)
                  }
                  placeholder="Token de usuário CONAM"
                />
              </div>
              <div>
                <Label htmlFor="certificadoToken2">Token 2 (Senha Webservice)</Label>
                <Input
                  id="certificadoToken2"
                  type="password"
                  value={form.certificadoToken2}
                  onChange={(e) =>
                    updateField("certificadoToken2", e.target.value)
                  }
                  placeholder="Senha do webservice CONAM"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Cadastre ou solicite os tokens em vre.atende@taboaodaserra.sp.gov.br
                </p>
              </div>
            </div>
          ) : (
            /* Campinas / São Paulo — Certificado A1 */
            <div className="space-y-4">
              {form.hasCertificado && (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  Certificado digital configurado. Faça upload abaixo para substituir.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="certFile">Certificado (.pfx)</Label>
                  <Input
                    id="certFile"
                    ref={fileInputRef}
                    type="file"
                    accept=".pfx,.p12"
                    onChange={(e) =>
                      setCertFile(e.target.files?.[0] ?? null)
                    }
                    className="cursor-pointer"
                  />
                </div>
                <div>
                  <Label htmlFor="certSenha">Senha do Certificado</Label>
                  <Input
                    id="certSenha"
                    type="password"
                    value={certSenha}
                    onChange={(e) => setCertSenha(e.target.value)}
                    placeholder="Senha do arquivo .pfx"
                  />
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleSaveCertificado}
                disabled={savingCert || !certFile || !certSenha}
              >
                <Upload className="mr-2 h-4 w-4" />
                {savingCert ? "Salvando certificado..." : "Salvar Certificado"}
              </Button>
              <p className="text-xs text-muted-foreground">
                O certificado é encriptado com AES-128 antes de ser armazenado. A senha nunca é salva em texto puro.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NFS-e — Série e Numeração */}
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
