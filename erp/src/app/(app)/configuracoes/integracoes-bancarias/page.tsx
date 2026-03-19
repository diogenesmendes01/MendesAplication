"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Plug,
  Star,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Landmark,
  X,
  Upload,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "@/contexts/company-context";
import {
  getPaymentProviders,
  getAvailableProviders,
  savePaymentProvider,
  deletePaymentProvider,
  testProviderConnection,
  saveRoutingRules,
  toggleProviderActive,
  setDefaultProvider,
} from "./actions";
import type {
  PaymentProviderData,
  RoutingRuleData,
  SavePaymentProviderInput,
  SaveRoutingRuleInput,
} from "./actions";
import type { ProviderDefinition, ConfigField } from "@/lib/payment";
import type { ClientType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_TYPE_OPTIONS = [
  { value: "__any__", label: "Qualquer" },
  { value: "PF", label: "PF" },
  { value: "PJ", label: "PJ" },
];

function emptyRule(): RuleFormData {
  return {
    priority: 0,
    clientType: "__any__",
    minValue: "",
    maxValue: "",
    tags: "",
    isActive: true,
  };
}

interface RuleFormData {
  priority: number;
  clientType: string;
  minValue: string;
  maxValue: string;
  tags: string;
  isActive: boolean;
}

function ruleToForm(r: RoutingRuleData): RuleFormData {
  return {
    priority: r.priority,
    clientType: r.clientType ?? "__any__",
    minValue: r.minValue !== null ? String(r.minValue) : "",
    maxValue: r.maxValue !== null ? String(r.maxValue) : "",
    tags: r.tags.join(", "),
    isActive: r.isActive,
  };
}

function formToRule(r: RuleFormData): SaveRoutingRuleInput {
  return {
    priority: r.priority,
    clientType: r.clientType === "__any__" ? null : (r.clientType as ClientType),
    minValue: r.minValue ? parseFloat(r.minValue) : null,
    maxValue: r.maxValue ? parseFloat(r.maxValue) : null,
    tags: r.tags
      ? r.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    isActive: r.isActive,
  };
}

/**
 * Detects PEM certificate fields: type "password" with helpText mentioning PEM.
 * These fields need a textarea + file upload instead of a simple password input.
 */
function isPemCertificateField(field: ConfigField): boolean {
  return (
    field.type === "password" &&
    !!field.helpText &&
    field.helpText.toLowerCase().includes("pem")
  );
}

/**
 * Validates that a PEM string starts with the expected header.
 */
function isValidPem(value: string): boolean {
  return value.trimStart().startsWith("-----BEGIN");
}

// ---------------------------------------------------------------------------
// PEM Certificate Field Component
// ---------------------------------------------------------------------------

function PemCertificateField({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: string;
  onChange: (val: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasValue = value.length > 0 && !value.startsWith("****");
  const isValid = !hasValue || isValidPem(value);
  const fileExtension = field.key === "certificateKey" ? ".key,.pem" : ".crt,.pem,.cer";

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50_000) {
      toast.error("Arquivo muito grande. Certificados PEM normalmente têm menos de 10KB.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      onChange(content);
      if (!isValidPem(content)) {
        toast.error(
          `Arquivo "${file.name}" não parece ser um certificado PEM válido. O conteúdo deve começar com "-----BEGIN".`,
        );
      } else {
        toast.success(`Arquivo "${file.name}" carregado`);
      }
    };
    reader.onerror = () => {
      toast.error(`Erro ao ler arquivo "${file.name}"`);
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-selected
    e.target.value = "";
  }

  return (
    <div className="sm:col-span-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={field.key}>
          {field.label}
          {field.required && <span className="text-danger ml-1">*</span>}
        </Label>
        {hasValue && isValid && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3 w-3" />
            PEM válido
          </span>
        )}
        {hasValue && !isValid && (
          <span className="text-xs text-danger">
            PEM deve começar com &quot;-----BEGIN&quot;
          </span>
        )}
      </div>
      <div className="mt-1 space-y-2">
        <Textarea
          id={field.key}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Cole o conteúdo do ${field.label} aqui...\n-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----`}
          className="font-mono text-xs min-h-[120px] resize-y"
          rows={6}
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload {field.key === "certificateKey" ? ".KEY" : ".CRT"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={fileExtension}
            onChange={handleFileUpload}
            className="hidden"
          />
          {hasValue && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-text-secondary"
              onClick={() => onChange("")}
            >
              Limpar
            </Button>
          )}
          <span className="text-xs text-text-tertiary ml-auto">
            Aceita: {fileExtension}
          </span>
        </div>
      </div>
      {field.helpText && (
        <p className="text-xs text-text-secondary mt-1">{field.helpText}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dynamic field renderer
// ---------------------------------------------------------------------------

function DynamicField({
  field,
  value,
  onChange,
  visiblePasswords,
  onToggleVisibility,
}: {
  field: ConfigField;
  value: string;
  onChange: (val: string) => void;
  visiblePasswords: Set<string>;
  onToggleVisibility: (key: string) => void;
}) {
  // PEM certificate fields: render as textarea + file upload
  if (isPemCertificateField(field)) {
    return (
      <PemCertificateField field={field} value={value} onChange={onChange} />
    );
  }

  if (field.type === "password") {
    const visible = visiblePasswords.has(field.key);
    return (
      <div>
        <Label htmlFor={field.key}>
          {field.label}
          {field.required && <span className="text-danger ml-1">*</span>}
        </Label>
        <div className="relative">
          <Input
            id={field.key}
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => onToggleVisibility(field.key)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {field.helpText && (
          <p className="text-xs text-text-secondary mt-1">{field.helpText}</p>
        )}
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div>
        <Label htmlFor={field.key}>
          {field.label}
          {field.required && <span className="text-danger ml-1">*</span>}
        </Label>
        <Input
          id={field.key}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
        {field.helpText && (
          <p className="text-xs text-text-secondary mt-1">{field.helpText}</p>
        )}
      </div>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <div>
        <Label htmlFor={field.key}>
          {field.label}
          {field.required && <span className="text-danger ml-1">*</span>}
        </Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={field.key}>
            <SelectValue placeholder={field.placeholder ?? "Selecione"} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.helpText && (
          <p className="text-xs text-text-secondary mt-1">{field.helpText}</p>
        )}
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-3">
        <Switch
          id={field.key}
          checked={value === "true"}
          onCheckedChange={(v) => onChange(String(v))}
        />
        <Label htmlFor={field.key} className="cursor-pointer">
          {field.label}
        </Label>
      </div>
    );
  }

  // Default: text
  return (
    <div>
      <Label htmlFor={field.key}>
        {field.label}
        {field.required && <span className="text-danger ml-1">*</span>}
      </Label>
      <Input
        id={field.key}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
      />
      {field.helpText && (
        <p className="text-xs text-text-secondary mt-1">{field.helpText}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntegracoesBancariasPage() {
  const { selectedCompanyId } = useCompany();
  const [providers, setProviders] = useState<PaymentProviderData[]>([]);
  const [registry, setRegistry] = useState<ProviderDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PaymentProviderData | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [editingProvider, setEditingProvider] = useState<PaymentProviderData | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("");
  const [formCredentials, setFormCredentials] = useState<Record<string, string>>({});
  const [formSettings, setFormSettings] = useState<Record<string, string>>({});
  const [formSandbox, setFormSandbox] = useState(false);
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [formRules, setFormRules] = useState<RuleFormData[]>([]);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  // ------ Load data ------

  const loadProviders = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const [provs, reg] = await Promise.all([
        getPaymentProviders(selectedCompanyId),
        getAvailableProviders(),
      ]);
      setProviders(provs);
      setRegistry(reg);
    } catch {
      toast.error("Erro ao carregar integrações bancárias");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // ------ Provider type lookup ------

  const getDefinition = useCallback(
    (providerType: string): ProviderDefinition | undefined => {
      return registry.find((r) => r.id === providerType);
    },
    [registry],
  );

  // ------ Open dialog ------

  function openCreate() {
    setEditingProvider(null);
    setFormName("");
    setFormType("");
    setFormCredentials({});
    setFormSettings({});
    setFormSandbox(false);
    setFormIsDefault(false);
    setFormRules([]);
    setVisiblePasswords(new Set());
    setDialogOpen(true);
  }

  function openEdit(provider: PaymentProviderData) {
    setEditingProvider(provider);
    setFormName(provider.name);
    setFormType(provider.provider);
    // Bug #2 fix: Clear password fields to "" to avoid masked values overwriting real credentials
    const def = registry.find((r) => r.id === provider.provider);
    const passwordKeys = new Set(
      def?.configSchema.filter((f) => f.type === "password").map((f) => f.key) ?? [],
    );
    const cleanedCredentials: Record<string, string> = {};
    for (const [key, value] of Object.entries(provider.credentials)) {
      cleanedCredentials[key] = passwordKeys.has(key) ? "" : value;
    }
    setFormCredentials(cleanedCredentials);
    setFormSettings({ ...provider.settings });
    setFormSandbox(provider.sandbox);
    setFormIsDefault(provider.isDefault);
    setFormRules(provider.rules.map(ruleToForm));
    setVisiblePasswords(new Set());
    setDialogOpen(true);
  }

  // ------ When provider type changes, initialize empty credentials/settings ------

  function handleTypeChange(newType: string) {
    setFormType(newType);
    const def = registry.find((r) => r.id === newType);
    if (!def) return;

    // If editing same type, keep existing values; otherwise reset
    if (editingProvider && editingProvider.provider === newType) {
      return;
    }
    const creds: Record<string, string> = {};
    for (const f of def.configSchema) {
      creds[f.key] = "";
    }
    const settings: Record<string, string> = {};
    for (const f of def.settingsSchema) {
      settings[f.key] = "";
    }
    setFormCredentials(creds);
    setFormSettings(settings);
  }

  // ------ Save ------

  async function handleSave() {
    if (!selectedCompanyId) return;
    if (!formName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!formType) {
      toast.error("Selecione o tipo de banco");
      return;
    }

    // Validate required credential fields
    const def = getDefinition(formType);
    if (def) {
      for (const field of def.configSchema) {
        if (field.required && !editingProvider && !formCredentials[field.key]) {
          toast.error(`Campo "${field.label}" é obrigatório`);
          return;
        }

        // PEM certificate validation: if value is present, must start with -----BEGIN
        if (isPemCertificateField(field)) {
          const val = formCredentials[field.key];
          if (val && val.trim().length > 0 && !isValidPem(val)) {
            toast.error(
              `"${field.label}" não é um certificado PEM válido. Deve começar com "-----BEGIN".`,
            );
            return;
          }
        }
      }
    }

    setSaving(true);
    try {
      const input: SavePaymentProviderInput = {
        id: editingProvider?.id,
        name: formName.trim(),
        provider: formType,
        credentials: formCredentials,
        settings: formSettings,
        sandbox: formSandbox,
        isDefault: formIsDefault,
      };
      const { id: providerId } = await savePaymentProvider(selectedCompanyId, input);

      // Bug #13 fix: Always save routing rules (even empty array to delete old ones)
      await saveRoutingRules(
        selectedCompanyId,
        providerId,
        formRules.map(formToRule),
      );

      toast.success(editingProvider ? "Banco atualizado" : "Banco adicionado");
      setDialogOpen(false);
      await loadProviders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  // ------ Delete ------

  function confirmDelete(provider: PaymentProviderData) {
    setDeleteTarget(provider);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!selectedCompanyId || !deleteTarget) return;
    try {
      await deletePaymentProvider(selectedCompanyId, deleteTarget.id);
      toast.success(`"${deleteTarget.name}" removido`);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      await loadProviders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    }
  }

  // ------ Test connection ------

  async function handleTestConnection(providerId: string) {
    if (!selectedCompanyId) return;
    setTestingId(providerId);
    try {
      const result = await testProviderConnection(selectedCompanyId, providerId);
      if (result.ok) {
        toast.success(result.message || "Conexão OK");
      } else {
        toast.error(result.message || "Falha na conexão");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao testar");
    } finally {
      setTestingId(null);
    }
  }

  // ------ Toggle active ------

  async function handleToggleActive(provider: PaymentProviderData) {
    if (!selectedCompanyId) return;
    setTogglingId(provider.id);
    try {
      const result = await toggleProviderActive(selectedCompanyId, provider.id);
      toast.success(result.isActive ? `"${provider.name}" ativado` : `"${provider.name}" desativado`);
      await loadProviders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar status");
    } finally {
      setTogglingId(null);
    }
  }

  // ------ Set default ------

  async function handleSetDefault(providerId: string) {
    if (!selectedCompanyId) return;
    try {
      await setDefaultProvider(selectedCompanyId, providerId);
      toast.success("Banco padrão atualizado");
      await loadProviders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao definir padrão");
    }
  }

  // ------ Routing rules helpers ------

  function addRule() {
    setFormRules((prev) => [...prev, emptyRule()]);
  }

  function removeRule(index: number) {
    setFormRules((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRule(index: number, updates: Partial<RuleFormData>) {
    setFormRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...updates } : r)),
    );
  }

  function togglePasswordVisibility(key: string) {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // ------ Current definition for form ------

  const currentDef = formType ? getDefinition(formType) : undefined;

  // ------ Render ------

  if (!selectedCompanyId) {
    return (
      <p className="text-sm text-text-secondary">
        Selecione uma empresa para configurar.
      </p>
    );
  }

  if (loading) {
    return (
      <p className="text-sm text-text-secondary text-center py-12">
        Carregando integrações bancárias...
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Integrações Bancárias</h1>
          <p className="text-sm text-text-secondary">
            Configure seus providers de pagamento para geração automática de boletos.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar banco
        </Button>
      </div>

      {/* Provider cards */}
      {providers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Landmark className="h-12 w-12 text-text-tertiary mb-4" strokeWidth={1.5} />
            <h3 className="text-base font-medium mb-1">Nenhum banco configurado</h3>
            <p className="text-sm text-text-secondary mb-4">
              Adicione um provider de pagamento para começar a gerar boletos.
            </p>
            <Button onClick={openCreate} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Adicionar banco
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <Card key={provider.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                      {provider.name}
                      {provider.isDefault && (
                        <Star className="h-4 w-4 text-warning fill-warning flex-shrink-0" />
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {provider.rules.length}{" "}
                      {provider.rules.length === 1 ? "regra" : "regras"} de roteamento
                    </CardDescription>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <Badge variant="secondary">{provider.providerLabel}</Badge>
                    <Badge
                      variant={provider.isActive ? "success" : "destructive"}
                      withDot
                    >
                      {provider.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(provider)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testingId === provider.id}
                    onClick={() => handleTestConnection(provider.id)}
                  >
                    {testingId === provider.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plug className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Testar
                  </Button>
                  <div className="flex items-center gap-2 ml-auto">
                    <Switch
                      checked={provider.isActive}
                      disabled={togglingId === provider.id}
                      onCheckedChange={() => handleToggleActive(provider)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {!provider.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-text-secondary"
                      onClick={() => handleSetDefault(provider.id)}
                    >
                      <Star className="mr-1 h-3 w-3" />
                      Definir padrão
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-danger hover:text-danger"
                    onClick={() => confirmDelete(provider)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Remover
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">
          <DialogHeader>
            <DialogTitle>
              {editingProvider ? "Editar banco" : "Adicionar banco"}
            </DialogTitle>
            <DialogDescription>
              {editingProvider
                ? "Atualize as configurações do provider de pagamento."
                : "Configure um novo provider de pagamento para geração de boletos."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Basic info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="providerName">Nome</Label>
                <Input
                  id="providerName"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Pagar.me Produção"
                />
              </div>
              <div>
                <Label htmlFor="providerType">Tipo</Label>
                <Select
                  value={formType}
                  onValueChange={handleTypeChange}
                  disabled={!!editingProvider}
                >
                  <SelectTrigger id="providerType">
                    <SelectValue placeholder="Selecione o banco" />
                  </SelectTrigger>
                  <SelectContent>
                    {registry.map((def) => (
                      <SelectItem key={def.id} value={def.id}>
                        {def.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dynamic credential fields */}
            {currentDef && currentDef.configSchema.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-text-primary">Credenciais</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {currentDef.configSchema.map((field) => (
                    <DynamicField
                      key={field.key}
                      field={field}
                      value={formCredentials[field.key] ?? ""}
                      onChange={(val) =>
                        setFormCredentials((prev) => ({ ...prev, [field.key]: val }))
                      }
                      visiblePasswords={visiblePasswords}
                      onToggleVisibility={togglePasswordVisibility}
                    />
                  ))}
                </div>
                {editingProvider && (
                  <p className="text-xs text-text-secondary">
                    Deixe campos de senha/certificado em branco para manter o valor atual.
                  </p>
                )}
              </div>
            )}

            {/* Dynamic settings fields */}
            {currentDef && currentDef.settingsSchema.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-text-primary">Configurações</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {currentDef.settingsSchema.map((field) => (
                    <DynamicField
                      key={field.key}
                      field={field}
                      value={formSettings[field.key] ?? ""}
                      onChange={(val) =>
                        setFormSettings((prev) => ({ ...prev, [field.key]: val }))
                      }
                      visiblePasswords={visiblePasswords}
                      onToggleVisibility={togglePasswordVisibility}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Toggles */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="sandbox"
                  checked={formSandbox}
                  onCheckedChange={setFormSandbox}
                />
                <Label htmlFor="sandbox" className="cursor-pointer">
                  Ambiente Sandbox (teste)
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="isDefault"
                  checked={formIsDefault}
                  onCheckedChange={setFormIsDefault}
                />
                <Label htmlFor="isDefault" className="cursor-pointer">
                  Banco padrão (usado quando nenhuma regra de roteamento casa)
                </Label>
              </div>
            </div>

            {/* Webhook URL (read-only, only for existing providers) */}
            {editingProvider?.webhookUrl && (
              <div>
                <Label>Webhook URL</Label>
                <Input
                  value={editingProvider.webhookUrl}
                  readOnly
                  className="bg-background-subtle text-text-secondary cursor-default"
                  onClick={(e) => {
                    (e.target as HTMLInputElement).select();
                    navigator.clipboard.writeText(editingProvider.webhookUrl ?? "");
                    toast.success("URL copiada");
                  }}
                />
                <p className="text-xs text-text-secondary mt-1">
                  Configure esta URL no painel do banco para receber notificações de pagamento.
                </p>
              </div>
            )}

            {/* Routing Rules */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary">
                  Regras de Roteamento
                </h3>
                <Button variant="outline" size="sm" onClick={addRule}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Adicionar regra
                </Button>
              </div>

              {formRules.length === 0 ? (
                <p className="text-xs text-text-secondary">
                  Sem regras. O roteamento automático usará este banco apenas se marcado como padrão.
                </p>
              ) : (
                <div className="space-y-3">
                  {formRules.map((rule, idx) => (
                    <div
                      key={idx}
                      className="border border-border rounded-lg p-3 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-secondary">
                          Regra {idx + 1}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-text-tertiary hover:text-danger"
                          onClick={() => removeRule(idx)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-5">
                        <div>
                          <Label className="text-xs">Prioridade</Label>
                          <Input
                            type="number"
                            min={0}
                            value={rule.priority}
                            onChange={(e) =>
                              updateRule(idx, {
                                priority: parseInt(e.target.value) || 0,
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Tipo Cliente</Label>
                          <Select
                            value={rule.clientType}
                            onValueChange={(v) =>
                              updateRule(idx, { clientType: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLIENT_TYPE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Valor mín</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            placeholder="Sem mín"
                            value={rule.minValue}
                            onChange={(e) =>
                              updateRule(idx, { minValue: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Valor máx</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            placeholder="Sem máx"
                            value={rule.maxValue}
                            onChange={(e) =>
                              updateRule(idx, { maxValue: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Tags</Label>
                          <Input
                            placeholder="tag1, tag2"
                            value={rule.tags}
                            onChange={(e) =>
                              updateRule(idx, { tags: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingProvider ? "Salvar alterações" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remover banco</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover &ldquo;{deleteTarget?.name}&rdquo;? Essa
              ação não pode ser desfeita. Boletos já gerados não serão afetados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
