"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  FolderTree,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  listChartOfAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  listParentOptions,
  seedDefaultChartOfAccounts,
  type AccountNode,
  type ParentOption,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: "Ativo",
  LIABILITY: "Passivo",
  EQUITY: "Patrimônio Líquido",
  REVENUE: "Receita",
  EXPENSE: "Despesa",
};

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  ASSET: "bg-blue-100 text-blue-800",
  LIABILITY: "bg-red-100 text-red-800",
  EQUITY: "bg-purple-100 text-purple-800",
  REVENUE: "bg-green-100 text-green-800",
  EXPENSE: "bg-orange-100 text-orange-800",
};

// ---------------------------------------------------------------------------
// Tree Node Component
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: AccountNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (node: AccountNode) => void;
  onDelete: (node: AccountNode) => void;
  onAddChild: (parentNode: AccountNode) => void;
}

function TreeNode({
  node,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAddChild,
}: TreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const indent = (node.level - 1) * 24;

  return (
    <>
      <div
        className="group flex items-center gap-2 border-b px-4 py-2 hover:bg-muted/50"
        style={{ paddingLeft: `${indent + 16}px` }}
      >
        {/* Expand/collapse toggle */}
        <button
          onClick={() => hasChildren && onToggle(node.id)}
          className={`flex h-5 w-5 items-center justify-center rounded ${hasChildren ? "cursor-pointer hover:bg-muted" : "cursor-default"}`}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )
          ) : (
            <span className="h-4 w-4" />
          )}
        </button>

        {/* Code */}
        <span className="min-w-[80px] font-mono text-sm font-medium text-muted-foreground">
          {node.code}
        </span>

        {/* Name */}
        <span className="flex-1 text-sm">{node.name}</span>

        {/* Type badge */}
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ACCOUNT_TYPE_COLORS[node.type] ?? "bg-gray-100 text-gray-800"}`}
        >
          {ACCOUNT_TYPE_LABELS[node.type] ?? node.type}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onAddChild(node)}
            title="Adicionar subconta"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onEdit(node)}
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={() => onDelete(node)}
            title="Excluir"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlanoDeContasPage() {
  const { selectedCompanyId } = useCompany();

  const [accounts, setAccounts] = useState<AccountNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<string>("ASSET");
  const [formParentId, setFormParentId] = useState("");
  const [parentOptions, setParentOptions] = useState<ParentOption[]>([]);

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingNode, setDeletingNode] = useState<AccountNode | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Seed confirmation
  const [seedDialogOpen, setSeedDialogOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadAccounts = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await listChartOfAccounts(selectedCompanyId);
      setAccounts(result);
      // Auto-expand level 1 on first load
      if (expanded.size === 0 && result.length > 0) {
        setExpanded(new Set(result.map((r) => r.id)));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar plano de contas"
      );
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // ---------------------------------------------------
  // Tree expand/collapse
  // ---------------------------------------------------

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function expandAll() {
    const allIds = new Set<string>();
    function collectIds(nodes: AccountNode[]) {
      for (const node of nodes) {
        if (node.children.length > 0) {
          allIds.add(node.id);
          collectIds(node.children);
        }
      }
    }
    collectIds(accounts);
    setExpanded(allIds);
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  // ---------------------------------------------------
  // Create / Edit dialog
  // ---------------------------------------------------

  async function openCreateDialog(parentNode?: AccountNode) {
    if (!selectedCompanyId) return;
    setEditingId(null);
    setFormCode(parentNode ? `${parentNode.code}.` : "");
    setFormName("");
    setFormType(parentNode ? parentNode.type : "ASSET");
    setFormParentId(parentNode?.id ?? "");
    setFormError("");

    try {
      const options = await listParentOptions(selectedCompanyId);
      setParentOptions(options);
    } catch {
      setParentOptions([]);
    }

    setDialogOpen(true);
  }

  async function openEditDialog(node: AccountNode) {
    if (!selectedCompanyId) return;
    setEditingId(node.id);
    setFormCode(node.code);
    setFormName(node.name);
    setFormType(node.type);
    setFormParentId(node.parentId ?? "");
    setFormError("");

    try {
      const options = await listParentOptions(selectedCompanyId, node.id);
      setParentOptions(options);
    } catch {
      setParentOptions([]);
    }

    setDialogOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId) return;
    setFormError("");
    setSaving(true);

    try {
      if (editingId) {
        await updateAccount({
          id: editingId,
          companyId: selectedCompanyId,
          code: formCode,
          name: formName,
          type: formType as "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
          parentId: formParentId || undefined,
        });
        toast.success("Conta atualizada com sucesso");
      } else {
        await createAccount({
          companyId: selectedCompanyId,
          code: formCode,
          name: formName,
          type: formType as "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
          parentId: formParentId || undefined,
        });
        toast.success("Conta criada com sucesso");
      }
      setDialogOpen(false);
      await loadAccounts();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao salvar conta"
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------
  // Delete
  // ---------------------------------------------------

  function openDeleteDialog(node: AccountNode) {
    setDeletingNode(node);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!selectedCompanyId || !deletingNode) return;
    setDeleting(true);
    try {
      await deleteAccount(deletingNode.id, selectedCompanyId);
      toast.success("Conta excluída com sucesso");
      setDeleteDialogOpen(false);
      setDeletingNode(null);
      await loadAccounts();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao excluir conta"
      );
    } finally {
      setDeleting(false);
    }
  }

  // ---------------------------------------------------
  // Seed default chart
  // ---------------------------------------------------

  async function handleSeedDefault() {
    if (!selectedCompanyId) return;
    setSeeding(true);
    try {
      const result = await seedDefaultChartOfAccounts(selectedCompanyId);
      toast.success(result.message);
      setSeedDialogOpen(false);
      await loadAccounts();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao criar plano de contas padrão"
      );
    } finally {
      setSeeding(false);
    }
  }

  // ---------------------------------------------------
  // No company selected
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar o plano de contas.
      </div>
    );
  }

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Plano de Contas
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie o plano de contas contábil da empresa
          </p>
        </div>
        <div className="flex gap-2">
          {accounts.length === 0 && !loading && (
            <Button variant="outline" onClick={() => setSeedDialogOpen(true)}>
              <Sparkles className="mr-2 h-4 w-4" />
              Criar Plano Padrão
            </Button>
          )}
          <Button onClick={() => openCreateDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Conta
          </Button>
        </div>
      </div>

      {/* Tree controls */}
      {accounts.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={expandAll}>
            <FolderTree className="mr-1 h-4 w-4" />
            Expandir Tudo
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll}>
            Recolher Tudo
          </Button>
        </div>
      )}

      {/* Tree view */}
      <div className="rounded-md border">
        {/* Header */}
        <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground">
          <span className="h-5 w-5" />
          <span className="min-w-[80px]">Código</span>
          <span className="flex-1">Nome</span>
          <span>Tipo</span>
          <span className="w-[100px]" />
        </div>

        {loading ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            Carregando...
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-2 text-muted-foreground">
            <span>Nenhuma conta cadastrada.</span>
            <span className="text-xs">
              Clique em &quot;Criar Plano Padrão&quot; para iniciar com o plano
              de contas brasileiro padrão.
            </span>
          </div>
        ) : (
          accounts.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              expanded={expanded}
              onToggle={toggleExpand}
              onEdit={openEditDialog}
              onDelete={openDeleteDialog}
              onAddChild={(parent) => openCreateDialog(parent)}
            />
          ))
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar Conta" : "Nova Conta"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Atualize os dados da conta contábil."
                : "Cadastre uma nova conta no plano de contas."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="code">Código *</Label>
                <Input
                  id="code"
                  placeholder="Ex: 1.1.1"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  required
                  disabled={saving}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Tipo *</Label>
                <Select
                  value={formType}
                  onValueChange={setFormType}
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ASSET">Ativo</SelectItem>
                    <SelectItem value="LIABILITY">Passivo</SelectItem>
                    <SelectItem value="EQUITY">Patrimônio Líquido</SelectItem>
                    <SelectItem value="REVENUE">Receita</SelectItem>
                    <SelectItem value="EXPENSE">Despesa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                placeholder="Ex: Caixa e Equivalentes"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label>Conta Pai</Label>
              <Select
                value={formParentId || "__none__"}
                onValueChange={(v) =>
                  setFormParentId(v === "__none__" ? "" : v)
                }
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhuma (conta raiz)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhuma (conta raiz)</SelectItem>
                  {parentOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {"  ".repeat(opt.level - 1)}
                      {opt.code} — {opt.name}
                    </SelectItem>
                  ))}
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
                    ? "Atualizar"
                    : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              Deseja excluir a conta{" "}
              <strong>
                {deletingNode?.code} — {deletingNode?.name}
              </strong>
              ?
              {deletingNode && deletingNode.children.length > 0 && (
                <span className="mt-2 block text-amber-600">
                  As subcontas serão movidas para o nível superior.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Seed Default Dialog */}
      <Dialog open={seedDialogOpen} onOpenChange={setSeedDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Plano de Contas Padrão</DialogTitle>
            <DialogDescription>
              Isso criará o plano de contas brasileiro padrão com as categorias:
              Ativo, Passivo, Patrimônio Líquido, Receitas e Despesas.
              Você poderá personalizar depois.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSeedDialogOpen(false)}
              disabled={seeding}
            >
              Cancelar
            </Button>
            <Button onClick={handleSeedDefault} disabled={seeding}>
              {seeding ? "Criando..." : "Criar Plano Padrão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
