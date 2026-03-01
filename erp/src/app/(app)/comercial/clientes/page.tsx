"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { isValidCpf } from "@/lib/cpf";
import { isValidCnpj } from "@/lib/cnpj";
import {
  listClients,
  createClient,
  updateClient,
  getClientForEdit,
  type ClientInput,
  type ClientRow,
  type PaginatedResult,
} from "./actions";

// ---------------------------------------------------------------------------
// Mask helpers
// ---------------------------------------------------------------------------

function applyCpfMask(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function applyCnpjMask(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function applyCpfCnpjMask(value: string, type: "PF" | "PJ"): string {
  return type === "PF" ? applyCpfMask(value) : applyCnpjMask(value);
}

// ---------------------------------------------------------------------------
// Empty form state
// ---------------------------------------------------------------------------

const emptyForm: ClientInput = {
  name: "",
  razaoSocial: "",
  cpfCnpj: "",
  email: "",
  telefone: "",
  endereco: "",
  type: "PF",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ClientesPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompany();

  const [clients, setClients] = useState<PaginatedResult<ClientRow> | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientInput>(emptyForm);
  const [cpfCnpjError, setCpfCnpjError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // ---------------------------------------------------
  // Load clients
  // ---------------------------------------------------

  const loadClients = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await listClients({
        companyId: selectedCompanyId,
        page,
        search: search || undefined,
      });
      setClients(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar clientes"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, page, search]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  // ---------------------------------------------------
  // Open dialogs
  // ---------------------------------------------------

  function openCreateDialog() {
    setEditingId(null);
    setForm(emptyForm);
    setCpfCnpjError("");
    setFormError("");
    setDialogOpen(true);
  }

  async function openEditDialog(clientId: string) {
    if (!selectedCompanyId) return;
    try {
      const client = await getClientForEdit(clientId, selectedCompanyId);
      setEditingId(client.id);
      setForm({
        name: client.name,
        razaoSocial: client.razaoSocial ?? "",
        cpfCnpj: client.cpfCnpj,
        email: client.email ?? "",
        telefone: client.telefone ?? "",
        endereco: client.endereco ?? "",
        type: client.type,
      });
      setCpfCnpjError("");
      setFormError("");
      setDialogOpen(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar cliente"
      );
    }
  }

  // ---------------------------------------------------
  // CPF/CNPJ inline validation
  // ---------------------------------------------------

  function handleCpfCnpjChange(value: string) {
    const masked = applyCpfCnpjMask(value, form.type);
    setForm((prev) => ({ ...prev, cpfCnpj: masked }));

    const digits = masked.replace(/\D/g, "");
    if (form.type === "PF") {
      if (digits.length === 11) {
        setCpfCnpjError(isValidCpf(masked) ? "" : "CPF inválido");
      } else {
        setCpfCnpjError("");
      }
    } else {
      if (digits.length === 14) {
        setCpfCnpjError(isValidCnpj(masked) ? "" : "CNPJ inválido");
      } else {
        setCpfCnpjError("");
      }
    }
  }

  function handleTypeChange(newType: "PF" | "PJ") {
    setForm((prev) => ({ ...prev, type: newType, cpfCnpj: "" }));
    setCpfCnpjError("");
  }

  // ---------------------------------------------------
  // Submit form
  // ---------------------------------------------------

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId) return;
    setFormError("");
    setSaving(true);

    try {
      if (editingId) {
        await updateClient(editingId, form, selectedCompanyId);
        toast.success("Cliente atualizado com sucesso");
      } else {
        await createClient(form, selectedCompanyId);
        toast.success("Cliente cadastrado com sucesso");
      }
      setDialogOpen(false);
      await loadClients();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao salvar cliente"
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para gerenciar clientes.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os clientes da empresa
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Cliente
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, CPF/CNPJ ou email..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CPF/CNPJ</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : !clients?.data.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            ) : (
              clients.data.map((client) => (
                <TableRow
                  key={client.id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(`/comercial/clientes/${client.id}`)
                  }
                >
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {client.cpfCnpj}
                  </TableCell>
                  <TableCell>{client.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {client.type === "PJ" ? "PJ" : "PF"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/comercial/clientes/${client.id}`);
                        }}
                        title="Ver detalhes"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(client.id);
                        }}
                        title="Editar cliente"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {clients && clients.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {clients.page} de {clients.totalPages} ({clients.total}{" "}
            clientes)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={clients.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={clients.page >= clients.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próximo
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar Cliente" : "Novo Cliente"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Altere os dados do cliente."
                : "Preencha os dados para cadastrar um novo cliente."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Tipo (PF/PJ) */}
            <div className="space-y-2">
              <Label htmlFor="type">Tipo *</Label>
              <Select
                value={form.type}
                onValueChange={(v) => handleTypeChange(v as "PF" | "PJ")}
                disabled={saving}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PF">Pessoa Física</SelectItem>
                  <SelectItem value="PJ">Pessoa Jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Nome */}
            <div className="space-y-2">
              <Label htmlFor="name">
                {form.type === "PJ" ? "Nome Fantasia *" : "Nome *"}
              </Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                required
                disabled={saving}
              />
            </div>

            {/* Razão Social (PJ only) */}
            {form.type === "PJ" && (
              <div className="space-y-2">
                <Label htmlFor="razaoSocial">Razão Social</Label>
                <Input
                  id="razaoSocial"
                  value={form.razaoSocial ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      razaoSocial: e.target.value,
                    }))
                  }
                  disabled={saving}
                />
              </div>
            )}

            {/* CPF/CNPJ */}
            <div className="space-y-2">
              <Label htmlFor="cpfCnpj">
                {form.type === "PF" ? "CPF *" : "CNPJ *"}
              </Label>
              <Input
                id="cpfCnpj"
                value={form.cpfCnpj}
                onChange={(e) => handleCpfCnpjChange(e.target.value)}
                placeholder={
                  form.type === "PF"
                    ? "XXX.XXX.XXX-XX"
                    : "XX.XXX.XXX/XXXX-XX"
                }
                required
                disabled={saving}
              />
              {cpfCnpjError && (
                <p className="text-xs text-destructive">{cpfCnpjError}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, email: e.target.value }))
                }
                disabled={saving}
              />
            </div>

            {/* Telefone */}
            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input
                id="telefone"
                value={form.telefone ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, telefone: e.target.value }))
                }
                disabled={saving}
              />
            </div>

            {/* Endereço */}
            <div className="space-y-2">
              <Label htmlFor="endereco">Endereço</Label>
              <Input
                id="endereco"
                value={form.endereco ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, endereco: e.target.value }))
                }
                disabled={saving}
              />
            </div>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving || !!cpfCnpjError}>
                {saving
                  ? "Salvando..."
                  : editingId
                    ? "Salvar Alterações"
                    : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
