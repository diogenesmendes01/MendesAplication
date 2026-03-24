"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  Mail,
  MessageSquare,
  ShieldAlert,
  Power,
  PowerOff,
  Pencil,
  Wifi,
  Clock,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/company-context";
import {
  listChannels,
  createChannel,
  updateChannel,
  toggleChannel,
  testChannelConnection,
  testRaConnection,
  type ChannelRow,
  type TestConnectionResult,
  type TestRaConnectionResult,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function channelIcon(type: string) {
  if (type === "EMAIL") return <Mail className="h-5 w-5" />;
  if (type === "RECLAMEAQUI") return <ShieldAlert className="h-5 w-5" />;
  return <MessageSquare className="h-5 w-5" />;
}

function channelLabel(type: string): string {
  if (type === "EMAIL") return "Email";
  if (type === "RECLAMEAQUI") return "Reclame Aqui";
  return "WhatsApp";
}

function channelAddress(ch: ChannelRow): string {
  if (ch.type === "EMAIL") {
    return (ch.config.email as string) || "Não configurado";
  }
  if (ch.type === "RECLAMEAQUI") {
    return (ch.config.baseUrl as string) || "Não configurado";
  }
  return (ch.config.instanceName as string) || "Não configurado";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CanaisPage() {
  const { selectedCompanyId } = useCompany();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [channelType, setChannelType] = useState<"EMAIL" | "WHATSAPP" | "RECLAMEAQUI">("EMAIL");
  const [name, setName] = useState("");

  // Email config fields
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [emailAddress, setEmailAddress] = useState("");
  const [emailPassword, setEmailPassword] = useState("");

  // WhatsApp config fields
  const [instanceName, setInstanceName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Reclame Aqui config fields
  const [raClientId, setRaClientId] = useState("");
  const [raClientSecret, setRaClientSecret] = useState("");
  const [raBaseUrl, setRaBaseUrl] = useState("https://app.hugme.com.br/api");
  const [raPollInterval, setRaPollInterval] = useState("15");

  // RA test connection state
  const [testingRa, setTestingRa] = useState(false);
  const [raTestResult, setRaTestResult] = useState<TestRaConnectionResult | null>(null);

  // Test result (existing channels)
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const loadChannels = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const data = await listChannels(selectedCompanyId);
      setChannels(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar canais");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  function resetForm() {
    setName("");
    setChannelType("EMAIL");
    setImapHost("");
    setImapPort("993");
    setSmtpHost("");
    setSmtpPort("587");
    setEmailAddress("");
    setEmailPassword("");
    setInstanceName("");
    setApiUrl("");
    setApiKey("");
    setRaClientId("");
    setRaClientSecret("");
    setRaBaseUrl("https://app.hugme.com.br/api");
    setRaPollInterval("15");
    setRaTestResult(null);
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(ch: ChannelRow) {
    setEditingId(ch.id);
    setName(ch.name);
    setChannelType(ch.type);

    if (ch.type === "EMAIL") {
      setImapHost((ch.config.imapHost as string) || "");
      setImapPort(String(ch.config.imapPort || "993"));
      setSmtpHost((ch.config.smtpHost as string) || "");
      setSmtpPort(String(ch.config.smtpPort || "587"));
      setEmailAddress((ch.config.email as string) || "");
      setEmailPassword((ch.config.password as string) || "");
    } else if (ch.type === "RECLAMEAQUI") {
      setRaClientId((ch.config.clientId as string) || "");
      setRaClientSecret((ch.config.clientSecret as string) || "");
      setRaBaseUrl((ch.config.baseUrl as string) || "https://app.hugme.com.br/api");
      setRaPollInterval(String(ch.config.pollIntervalMinutes || "15"));
    } else {
      setInstanceName((ch.config.instanceName as string) || "");
      setApiUrl((ch.config.apiUrl as string) || "");
      setApiKey((ch.config.apiKey as string) || "");
    }

    setDialogOpen(true);
  }

  function buildConfig(): Record<string, unknown> {
    if (channelType === "EMAIL") {
      return {
        imapHost,
        imapPort: parseInt(imapPort, 10),
        smtpHost,
        smtpPort: parseInt(smtpPort, 10),
        email: emailAddress,
        password: emailPassword,
      };
    }
    if (channelType === "RECLAMEAQUI") {
      return {
        clientId: raClientId,
        clientSecret: raClientSecret,
        baseUrl: raBaseUrl,
        pollIntervalMinutes: parseInt(raPollInterval, 10) || 15,
        ...(raTestResult?.success && raTestResult.companyId
          ? { companyId: raTestResult.companyId, companyName: raTestResult.companyName }
          : {}),
      };
    }
    return { instanceName, apiUrl, apiKey };
  }

  async function handleSave() {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateChannel({
          channelId: editingId,
          companyId: selectedCompanyId,
          name,
          config: buildConfig(),
        });
        toast.success("Canal atualizado com sucesso");
      } else {
        await createChannel({
          companyId: selectedCompanyId,
          type: channelType,
          name,
          config: buildConfig(),
        });
        toast.success("Canal criado com sucesso");
      }
      setDialogOpen(false);
      resetForm();
      await loadChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar canal");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(channelId: string) {
    if (!selectedCompanyId) return;
    try {
      const result = await toggleChannel(channelId, selectedCompanyId);
      toast.success(result.isActive ? "Canal ativado" : "Canal desativado");
      await loadChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar status");
    }
  }

  async function handleTest(channelId: string) {
    if (!selectedCompanyId) return;
    setTesting(channelId);
    setTestResult(null);
    try {
      const result = await testChannelConnection(channelId, selectedCompanyId);
      setTestResult(result);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao testar conexão");
    } finally {
      setTesting(null);
    }
  }

  async function handleTestRaConnection() {
    if (!raClientId || !raClientSecret || !raBaseUrl) {
      toast.error("Preencha Client ID, Client Secret e URL base");
      return;
    }
    setTestingRa(true);
    setRaTestResult(null);
    try {
      const result = await testRaConnection({
        clientId: raClientId,
        clientSecret: raClientSecret,
        baseUrl: raBaseUrl,
      });
      setRaTestResult(result);
      if (result.success) {
        toast.success(
          result.companyName
            ? `Conectado! Empresa: ${result.companyName}`
            : "Conexão bem-sucedida!"
        );
      } else {
        toast.error(result.error || "Falha na conexão");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao testar conexão");
    } finally {
      setTestingRa(false);
    }
  }

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para configurar canais.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Canais de Comunicação</h1>
          <p className="text-sm text-muted-foreground">
            Configure canais de email, WhatsApp e Reclame Aqui para a empresa
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Canal
        </Button>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          Carregando...
        </div>
      ) : channels.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          Nenhum canal configurado. Clique em &quot;Novo Canal&quot; para começar.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {channels.map((ch) => (
            <Card key={ch.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-muted p-2">
                      {channelIcon(ch.type)}
                    </div>
                    <div>
                      <h3 className="font-medium">{ch.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {channelAddress(ch)}
                      </p>
                    </div>
                  </div>
                  <Badge variant={ch.isActive ? "default" : "secondary"}>
                    {ch.isActive ? "Ativo" : "Inativo"}
                  </Badge>
                </div>

                {ch.lastSyncAt && (
                  <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Última sync: {dateFmt.format(new Date(ch.lastSyncAt))}
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(ch)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(ch.id)}
                    disabled={testing === ch.id}
                  >
                    <Wifi className="mr-1 h-3.5 w-3.5" />
                    {testing === ch.id ? "Testando..." : "Testar"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggle(ch.id)}
                  >
                    {ch.isActive ? (
                      <>
                        <PowerOff className="mr-1 h-3.5 w-3.5" />
                        Desativar
                      </>
                    ) : (
                      <>
                        <Power className="mr-1 h-3.5 w-3.5" />
                        Ativar
                      </>
                    )}
                  </Button>
                </div>

                {testResult && testing === null && (
                  <div
                    className={`mt-2 rounded p-2 text-xs ${
                      testResult.success
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {testResult.message}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Canal" : "Novo Canal"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editingId && (
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={channelType}
                  onValueChange={(v) =>
                    setChannelType(v as "EMAIL" | "WHATSAPP" | "RECLAMEAQUI")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMAIL">Email (IMAP/SMTP)</SelectItem>
                    <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                    <SelectItem value="RECLAMEAQUI">Reclame Aqui</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="channel-name">Nome</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  channelType === "RECLAMEAQUI"
                    ? "Ex: Reclame Aqui TrustCloud"
                    : "Ex: Email Suporte, WhatsApp Comercial"
                }
              />
            </div>

            {channelType === "EMAIL" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Host IMAP</Label>
                    <Input
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      placeholder="imap.gmail.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Porta IMAP</Label>
                    <Input
                      value={imapPort}
                      onChange={(e) => setImapPort(e.target.value)}
                      placeholder="993"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Host SMTP</Label>
                    <Input
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Porta SMTP</Label>
                    <Input
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                      placeholder="587"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    placeholder="suporte@empresa.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Senha</Label>
                  <Input
                    type="password"
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="Senha do email"
                  />
                </div>
              </>
            ) : channelType === "RECLAMEAQUI" ? (
              <>
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input
                    value={raClientId}
                    onChange={(e) => setRaClientId(e.target.value)}
                    placeholder="Client ID do HugMe"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client Secret</Label>
                  <Input
                    type="password"
                    value={raClientSecret}
                    onChange={(e) => setRaClientSecret(e.target.value)}
                    placeholder="Client Secret do HugMe"
                  />
                </div>
                <div className="space-y-2">
                  <Label>URL Base</Label>
                  <Input
                    value={raBaseUrl}
                    onChange={(e) => setRaBaseUrl(e.target.value)}
                    placeholder="https://app.hugme.com.br/api"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Intervalo de Polling (minutos)</Label>
                  <Input
                    type="number"
                    value={raPollInterval}
                    onChange={(e) => setRaPollInterval(e.target.value)}
                    placeholder="15"
                    min="1"
                    max="60"
                  />
                </div>

                {/* Test RA Connection */}
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestRaConnection}
                    disabled={testingRa || !raClientId || !raClientSecret}
                    className="w-full"
                  >
                    {testingRa ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testando conexão...
                      </>
                    ) : (
                      <>
                        <Wifi className="mr-2 h-4 w-4" />
                        Testar Conexão
                      </>
                    )}
                  </Button>
                  {raTestResult && (
                    <div
                      className={`rounded p-2 text-xs ${
                        raTestResult.success
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {raTestResult.success ? (
                        <>
                          ✅ Conexão bem-sucedida!
                          {raTestResult.companyName && (
                            <span className="block mt-1">
                              Empresa: <strong>{raTestResult.companyName}</strong>
                              {raTestResult.companyId && (
                                <span className="text-muted-foreground">
                                  {" "}(ID: {raTestResult.companyId})
                                </span>
                              )}
                            </span>
                          )}
                        </>
                      ) : (
                        <>❌ {raTestResult.error}</>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Nome da Instância</Label>
                  <Input
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    placeholder="mendes-comercial"
                  />
                </div>
                <div className="space-y-2">
                  <Label>API URL</Label>
                  <Input
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="http://localhost:8080"
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Chave da API"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
