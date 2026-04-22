"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Search,
  ChevronLeft,
  ChevronRight,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  listUsers,
  createUser,
  updateUser,
  getUserById,
  assignUserToCompanies,
  toggleUserStatus,
  listAllCompanies,
  type PaginatedResult,
  type CompanyAssignment,
} from "./actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CompanyOption {
  id: string;
  nomeFantasia: string;
}

const AVAILABLE_MODULES = [
  { value: "comercial", label: "Comercial" },
  { value: "sac", label: "SAC" },
  { value: "financeiro", label: "Financeiro" },
  { value: "fiscal", label: "Fiscal" },
  { value: "configuracoes", label: "Configurações" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UsuariosPage() {
  const [users, setUsers] = useState<PaginatedResult<User> | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // User form dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MANAGER">("MANAGER");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Company assignment dialog state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState<string | null>(null);
  const [assigningUserName, setAssigningUserName] = useState("");
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([]);
  const [assignments, setAssignments] = useState<
    Record<string, { selected: boolean; modules: string[] }>
  >({});
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [assignError, setAssignError] = useState("");

  // Toggling status
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ---------------------------------------------------
  // Load users
  // ---------------------------------------------------

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listUsers({ page, search: search || undefined });
      setUsers(result as PaginatedResult<User>);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar usuários"
      );
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  // ---------------------------------------------------
  // Open user form dialog
  // ---------------------------------------------------

  function openCreateDialog() {
    setEditingId(null);
    setName("");
    setEmail("");
    setPassword("");
    setRole("MANAGER");
    setFormError("");
    setDialogOpen(true);
  }

  async function openEditDialog(user: User) {
    setEditingId(user.id);
    setName(user.name);
    setEmail(user.email);
    setPassword("");
    setRole(user.role as "ADMIN" | "MANAGER");
    setFormError("");
    setDialogOpen(true);
  }

  // ---------------------------------------------------
  // Submit user form
  // ---------------------------------------------------

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    try {
      if (editingId) {
        await updateUser(editingId, {
          name,
          email,
          role,
          password: password || undefined,
        });
        toast.success("Usuário atualizado com sucesso");
      } else {
        await createUser({ name, email, password, role });
        toast.success("Usuário criado com sucesso");
      }
      setDialogOpen(false);
      await loadUsers();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao salvar usuário"
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
      await toggleUserStatus(id);
      toast.success("Status alterado com sucesso");
      await loadUsers();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao alterar status"
      );
    } finally {
      setTogglingId(null);
    }
  }

  // ---------------------------------------------------
  // Company assignment dialog
  // ---------------------------------------------------

  async function openAssignDialog(user: User) {
    setAssigningUserId(user.id);
    setAssigningUserName(user.name);
    setAssignError("");
    setAssignDialogOpen(true);

    try {
      // Load all companies and current assignments in parallel
      const [companies, userData] = await Promise.all([
        listAllCompanies(),
        getUserById(user.id),
      ]);

      setAllCompanies(companies as CompanyOption[]);

      // Build assignments map from current user data
      const assignMap: Record<
        string,
        { selected: boolean; modules: string[] }
      > = {};
      for (const company of companies) {
        assignMap[company.id] = { selected: false, modules: [] };
      }
      for (const uc of userData.userCompanies) {
        assignMap[uc.company.id] = { selected: true, modules: uc.modules };
      }
      setAssignments(assignMap);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar dados"
      );
      setAssignDialogOpen(false);
    }
  }

  function toggleCompanySelection(companyId: string) {
    setAssignments((prev) => ({
      ...prev,
      [companyId]: {
        ...prev[companyId],
        selected: !prev[companyId]?.selected,
        modules: !prev[companyId]?.selected
          ? prev[companyId]?.modules ?? []
          : [],
      },
    }));
  }

  function toggleModule(companyId: string, module: string) {
    setAssignments((prev) => {
      const current = prev[companyId];
      if (!current) return prev;
      const modules = current.modules.includes(module)
        ? current.modules.filter((m) => m !== module)
        : [...current.modules, module];
      return { ...prev, [companyId]: { ...current, modules } };
    });
  }

  async function handleSaveAssignments() {
    if (!assigningUserId) return;
    setSavingAssignments(true);
    setAssignError("");

    try {
      const selected: CompanyAssignment[] = Object.entries(assignments)
        .filter(([, v]) => v.selected)
        .map(([companyId, v]) => ({ companyId, modules: v.modules }));

      await assignUserToCompanies(assigningUserId, selected);
      toast.success("Permissões atualizadas com sucesso");
      setAssignDialogOpen(false);
    } catch (err) {
      setAssignError(
        err instanceof Error ? err.message : "Erro ao salvar permissões"
      );
    } finally {
      setSavingAssignments(false);
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
          <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os usuários e suas permissões
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou email..."
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
              <TableHead>Email</TableHead>
              <TableHead>Perfil</TableHead>
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
            ) : !users?.data.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Nenhum usuário encontrado.
                </TableCell>
              </TableRow>
            ) : (
              users.data.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        user.role === "ADMIN"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {user.role === "ADMIN" ? "Admin" : "Manager"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => handleToggleStatus(user.id)}
                      disabled={togglingId === user.id}
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                        user.status === "ACTIVE"
                          ? "bg-green-100 text-green-800 hover:bg-green-200"
                          : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                      } ${togglingId === user.id ? "opacity-50" : "cursor-pointer"}`}
                    >
                      {user.status === "ACTIVE" ? "Ativo" : "Inativo"}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openAssignDialog(user)}
                        title="Gerenciar empresas e módulos"
                      >
                        <UserCog className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(user)}
                        title="Editar usuário"
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
      {users && users.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {users.page} de {users.totalPages} ({users.total} usuários)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={users.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={users.page >= users.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próximo
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create / Edit User Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar Usuário" : "Novo Usuário"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Altere os dados do usuário."
                : "Preencha os dados para criar um novo usuário."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nome */}
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={saving}
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={saving}
              />
            </div>

            {/* Senha */}
            <div className="space-y-2">
              <Label htmlFor="password">
                {editingId ? "Nova Senha (deixe em branco para manter)" : "Senha *"}
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!editingId}
                minLength={6}
                disabled={saving}
                placeholder={editingId ? "••••••" : ""}
              />
            </div>

            {/* Perfil */}
            <div className="space-y-2">
              <Label htmlFor="role">Perfil *</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as "ADMIN" | "MANAGER")}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o perfil" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                </SelectContent>
              </Select>
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
              <Button type="submit" disabled={saving}>
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

      {/* Company Assignment Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Empresas e Módulos</DialogTitle>
            <DialogDescription>
              Configure as empresas e módulos que{" "}
              <strong>{assigningUserName}</strong> pode acessar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {allCompanies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma empresa cadastrada.
              </p>
            ) : (
              allCompanies.map((company) => {
                const companyAssign = assignments[company.id];
                const isSelected = companyAssign?.selected ?? false;

                return (
                  <div
                    key={company.id}
                    className={`rounded-lg border p-4 transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    {/* Company checkbox */}
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`company-${company.id}`}
                        checked={isSelected}
                        onCheckedChange={() =>
                          toggleCompanySelection(company.id)
                        }
                        disabled={savingAssignments}
                      />
                      <Label
                        htmlFor={`company-${company.id}`}
                        className="cursor-pointer font-medium"
                      >
                        {company.nomeFantasia}
                      </Label>
                    </div>

                    {/* Module checkboxes */}
                    {isSelected && (
                      <div className="ml-6 mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {AVAILABLE_MODULES.map((mod) => (
                          <div
                            key={mod.value}
                            className="flex items-center space-x-2"
                          >
                            <Checkbox
                              id={`mod-${company.id}-${mod.value}`}
                              checked={
                                companyAssign?.modules.includes(mod.value) ??
                                false
                              }
                              onCheckedChange={() =>
                                toggleModule(company.id, mod.value)
                              }
                              disabled={savingAssignments}
                            />
                            <Label
                              htmlFor={`mod-${company.id}-${mod.value}`}
                              className="cursor-pointer text-sm font-normal"
                            >
                              {mod.label}
                            </Label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {assignError && (
              <p className="text-sm text-destructive">{assignError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAssignDialogOpen(false)}
              disabled={savingAssignments}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveAssignments}
              disabled={savingAssignments}
            >
              {savingAssignments ? "Salvando..." : "Salvar Permissões"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
