"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  listCompanies,
  createCompany,
  updateCompany,
  toggleCompanyStatus,
  type CompanyInput,
  type PaginatedResult,
} from "./actions";
import { isValidCnpj } from "@/lib/cnpj";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Company {
  id: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoEstadual: string | null;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  segmento: string | null;
  logoUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// CNPJ Mask Helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Empty form state
// ---------------------------------------------------------------------------

const emptyForm: CompanyInput = {
  razaoSocial: "",
  nomeFantasia: "",
  cnpj: "",
  inscricaoEstadual: "",
  endereco: "",
  telefone: "",
  email: "",
  segmento: "",
  logoUrl: "",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EmpresasPage() {
  const [companies, setCompanies] = useState<PaginatedResult<Company> | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CompanyInput>(emptyForm);
  const [cnpjError, setCnpjError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Toggling status
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ---------------------------------------------------
  // Load companies
  // ---------------------------------------------------

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCompanies({ page, search: search || undefined });
      setCompanies(result as PaginatedResult<Company>);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar empresas"
      );
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  // Reset to page 1 when search changes
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
    setCnpjError("");
    setFormError("");
    setDialogOpen(true);
  }

  function openEditDialog(company: Company) {
    setEditingId(company.id);
    setForm({
      razaoSocial: company.razaoSocial,
      nomeFantasia: company.nomeFantasia,
      cnpj: company.cnpj,
      inscricaoEstadual: company.inscricaoEstadual ?? "",
      endereco: company.endereco ?? "",
      telefone: company.telefone ?? "",
      email: company.email ?? "",
      segmento: company.segmento ?? "",
      logoUrl: company.logoUrl ?? "",
    });
    setCnpjError("");
    setFormError("");
    setDialogOpen(true);
  }

  // ---------------------------------------------------
  // CNPJ inline validation
  // ---------------------------------------------------

  function handleCnpjChange(value: string) {
    const masked = applyCnpjMask(value);
    setForm((prev) => ({ ...prev, cnpj: masked }));

    const digits = masked.replace(/\D/g, "");
    if (digits.length === 14) {
      if (!isValidCnpj(masked)) {
        setCnpjError("CNPJ inválido");
      } else {
        setCnpjError("");
      }
    } else if (digits.length > 0) {
      setCnpjError("");
    }
  }

  // ---------------------------------------------------
  // Submit form
  // ---------------------------------------------------

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    try {
      if (editingId) {
        await updateCompany(editingId, form);
        toast.success("Empresa atualizada com sucesso");
      } else {
        await createCompany(form);
        toast.success("Empresa criada com sucesso");
      }
      setDialogOpen(false);
      await loadCompanies();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao salvar empresa"
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------
  // Toggle status
  // ---------------------------------------------------

  async function handleToggleStatus(id: string) {
    setTogglingId(id);
    try {
      await toggleCompanyStatus(id);
      toast.success("Status alterado com sucesso");
      await loadCompanies();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao alterar status"
      );
    } finally {
      setTogglingId(null);
    }
  }

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie as empresas do ecossistema
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Empresa
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou CNPJ..."
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
              <TableHead>Nome Fantasia</TableHead>
              <TableHead>Razão Social</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Status</TableHead>
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
            ) : !companies?.data.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Nenhuma empresa encontrada.
                </TableCell>
              </TableRow>
            ) : (
              companies.data.map((company) => (
                <TableRow key={company.id}>
                  <TableCell className="font-medium">
                    {company.nomeFantasia}
                  </TableCell>
                  <TableCell>{company.razaoSocial}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {company.cnpj}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => handleToggleStatus(company.id)}
                      disabled={togglingId === company.id}
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                        company.status === "ACTIVE"
                          ? "bg-green-100 text-green-800 hover:bg-green-200"
                          : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                      } ${togglingId === company.id ? "opacity-50" : "cursor-pointer"}`}
                    >
                      {company.status === "ACTIVE" ? "Ativo" : "Inativo"}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(company)}
                      title="Editar empresa"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {companies && companies.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {companies.page} de {companies.totalPages} ({companies.total}{" "}
            empresas)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={companies.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={companies.page >= companies.totalPages}
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
              {editingId ? "Editar Empresa" : "Nova Empresa"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Altere os dados da empresa."
                : "Preencha os dados para cadastrar uma nova empresa."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Razão Social */}
            <div className="space-y-2">
              <Label htmlFor="razaoSocial">Razão Social *</Label>
              <Input
                id="razaoSocial"
                value={form.razaoSocial}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, razaoSocial: e.target.value }))
                }
                required
                disabled={saving}
              />
            </div>

            {/* Nome Fantasia */}
            <div className="space-y-2">
              <Label htmlFor="nomeFantasia">Nome Fantasia *</Label>
              <Input
                id="nomeFantasia"
                value={form.nomeFantasia}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    nomeFantasia: e.target.value,
                  }))
                }
                required
                disabled={saving}
              />
            </div>

            {/* CNPJ */}
            <div className="space-y-2">
              <Label htmlFor="cnpj">CNPJ *</Label>
              <Input
                id="cnpj"
                value={form.cnpj}
                onChange={(e) => handleCnpjChange(e.target.value)}
                placeholder="XX.XXX.XXX/XXXX-XX"
                required
                disabled={saving}
              />
              {cnpjError && (
                <p className="text-xs text-destructive">{cnpjError}</p>
              )}
            </div>

            {/* Inscrição Estadual */}
            <div className="space-y-2">
              <Label htmlFor="inscricaoEstadual">Inscrição Estadual</Label>
              <Input
                id="inscricaoEstadual"
                value={form.inscricaoEstadual ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    inscricaoEstadual: e.target.value,
                  }))
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

            {/* Segmento */}
            <div className="space-y-2">
              <Label htmlFor="segmento">Segmento</Label>
              <Input
                id="segmento"
                value={form.segmento ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, segmento: e.target.value }))
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
              <Button type="submit" disabled={saving || !!cnpjError}>
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
