"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Filter,
  Pencil,
  AlertTriangle,
  Clock,
  Headphones,
} from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/company-context";
import {
  listPayables,
  createPayable,
  updatePayable,
  markPayableAsPaid,
  listCategoriesForSelect,
  getPayableAlerts,
  type PaginatedResult,
  type PayableRow,
  type CategoryOption,
  type PayableAlertSummary,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const currencyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function statusLabel(status: string) {
  switch (status) {
    case "PAID":
      return "Pago";
    case "OVERDUE":
      return "Vencido";
    default:
      return "Pendente";
  }
}

function statusColor(status: string) {
  switch (status) {
    case "PAID":
      return "bg-green-100 text-green-800";
    case "OVERDUE":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function rowHighlight(row: PayableRow): string {
  if (row.status === "PAID") return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDate = new Date(row.dueDate);
  if (row.status === "OVERDUE" || dueDate < startOfToday) {
    return "bg-red-50";
  }
  const sevenDaysFromNow = new Date(startOfToday);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  if (dueDate <= sevenDaysFromNow) {
    return "bg-yellow-50";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContasPagarPage() {
  const { selectedCompanyId } = useCompany();
  const router = useRouter();

  const [payables, setPayables] =
    useState<PaginatedResult<PayableRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Categories for filter/form
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formRecurrence, setFormRecurrence] = useState("NONE");

  // Alerts summary
  const [alerts, setAlerts] = useState<PayableAlertSummary | null>(null);

  // Mark as paid
  const [markingId, setMarkingId] = useState<string | null>(null);

  const hasActiveFilters =
    filterStatus !== "" ||
    filterSupplier !== "" ||
    filterCategoryId !== "" ||
    filterDateFrom !== "" ||
    filterDateTo !== "";

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadPayables = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      // Fetch alerts first (auto-updates overdue statuses), then payables
      const alertsResult = await getPayableAlerts(selectedCompanyId);
      setAlerts(alertsResult);

      const result = await listPayables({
        companyId: selectedCompanyId,
        page,
        status: filterStatus
          ? (filterStatus as "PENDING" | "PAID" | "OVERDUE")
          : undefined,
        supplier: filterSupplier || undefined,
        categoryId: filterCategoryId || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
      });
      setPayables(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar contas a pagar"
      );
    } finally {
      setLoading(false);
    }
  }, [
    selectedCompanyId,
    page,
    filterStatus,
    filterSupplier,
    filterCategoryId,
    filterDateFrom,
    filterDateTo,
  ]);

  useEffect(() => {
    loadPayables();
  }, [loadPayables]);

  // Load categories for dropdown
  useEffect(() => {
    if (!selectedCompanyId) return;
    listCategoriesForSelect(selectedCompanyId)
      .then(setCategories)
      .catch(() => {});
  }, [selectedCompanyId]);

  // ---------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------

  function handleFilterChange() {
    setPage(1);
  }

  function clearFilters() {
    setFilterStatus("");
    setFilterSupplier("");
    setFilterCategoryId("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
  }

  // ---------------------------------------------------
  // Create / Edit dialog
  // ---------------------------------------------------

  function openCreateDialog() {
    setEditingId(null);
    setFormSupplier("");
    setFormDescription("");
    setFormValue("");
    setFormDueDate("");
    setFormCategoryId("");
    setFormRecurrence("NONE");
    setFormError("");
    setDialogOpen(true);
  }

  function openEditDialog(row: PayableRow) {
    setEditingId(row.id);
    setFormSupplier(row.supplier);
    setFormDescription(row.description);
    setFormValue(parseFloat(row.value).toString());
    setFormDueDate(row.dueDate.split("T")[0]);
    setFormCategoryId(row.category?.id ?? "");
    setFormRecurrence(row.recurrence);
    setFormError("");
    setDialogOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId) return;
    setFormError("");
    setSaving(true);

    try {
      if (editingId) {
        await updatePayable({
          id: editingId,
          companyId: selectedCompanyId,
          supplier: formSupplier,
          description: formDescription,
          value: parseFloat(formValue),
          dueDate: formDueDate,
          categoryId: formCategoryId || undefined,
          recurrence: formRecurrence as "NONE" | "WEEKLY" | "MONTHLY" | "YEARLY",
        });
        toast.success("Conta a pagar atualizada com sucesso");
      } else {
        await createPayable({
          companyId: selectedCompanyId,
          supplier: formSupplier,
          description: formDescription,
          value: parseFloat(formValue),
          dueDate: formDueDate,
          categoryId: formCategoryId || undefined,
          recurrence: formRecurrence as "NONE" | "WEEKLY" | "MONTHLY" | "YEARLY",
        });
        toast.success("Conta a pagar criada com sucesso");
      }
      setDialogOpen(false);
      await loadPayables();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao salvar conta a pagar"
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------
  // Mark as paid
  // ---------------------------------------------------

  async function handleMarkAsPaid(id: string) {
    if (!selectedCompanyId) return;
    setMarkingId(id);
    try {
      await markPayableAsPaid(id, selectedCompanyId);
      toast.success("Conta marcada como paga");
      await loadPayables();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao marcar como paga"
      );
    } finally {
      setMarkingId(null);
    }
  }

  // ---------------------------------------------------
  // No company selected
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar as contas a pagar.
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
            Contas a Pagar
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie as contas a pagar da empresa
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Conta a Pagar
        </Button>
      </div>

      {/* Alert summary banner */}
      {alerts && (alerts.dueThisWeek > 0 || alerts.overdue > 0) && (
        <div className="flex flex-wrap gap-3">
          {alerts.overdue > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4" />
              <span>
                <strong>{alerts.overdue}</strong>{" "}
                {alerts.overdue === 1 ? "conta vencida" : "contas vencidas"}
              </span>
            </div>
          )}
          {alerts.dueThisWeek > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
              <Clock className="h-4 w-4" />
              <span>
                <strong>{alerts.dueThisWeek}</strong>{" "}
                {alerts.dueThisWeek === 1
                  ? "conta vence esta semana"
                  : "contas vencem esta semana"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Filters toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersVisible((v) => !v)}
        >
          <Filter className="mr-2 h-4 w-4" />
          Filtros
          {hasActiveFilters && (
            <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              !
            </span>
          )}
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Filter panel */}
      {filtersVisible && (
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={filterStatus || "__all__"}
              onValueChange={(v) => {
                setFilterStatus(v === "__all__" ? "" : v);
                handleFilterChange();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                <SelectItem value="PENDING">Pendente</SelectItem>
                <SelectItem value="PAID">Pago</SelectItem>
                <SelectItem value="OVERDUE">Vencido</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Fornecedor</Label>
            <Input
              placeholder="Buscar fornecedor..."
              value={filterSupplier}
              onChange={(e) => {
                setFilterSupplier(e.target.value);
                handleFilterChange();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select
              value={filterCategoryId || "__all__"}
              onValueChange={(v) => {
                setFilterCategoryId(v === "__all__" ? "" : v);
                handleFilterChange();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Vencimento de</Label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                handleFilterChange();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Vencimento até</Label>
            <Input
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                setFilterDateTo(e.target.value);
                handleFilterChange();
              }}
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fornecedor</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : !payables?.data.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  Nenhuma conta a pagar encontrada.
                </TableCell>
              </TableRow>
            ) : (
              payables.data.map((row) => (
                <TableRow key={row.id} className={rowHighlight(row)}>
                  <TableCell className="font-medium">
                    {row.supplier}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currencyFmt.format(parseFloat(row.value))}
                  </TableCell>
                  <TableCell>
                    {dateFmt.format(new Date(row.dueDate))}
                  </TableCell>
                  <TableCell>
                    {row.category?.name ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.origin === "REFUND" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 hover:bg-blue-200 transition-colors"
                        onClick={() => {
                          if (row.ticketId) {
                            router.push(`/sac/tickets/${row.ticketId}`);
                          }
                        }}
                        title={row.ticketId ? "Ver ticket de origem" : "Origem SAC"}
                      >
                        <Headphones className="h-3 w-3" />
                        SAC
                      </button>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                        Manual
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(row.status)}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {row.status !== "PAID" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(row)}
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleMarkAsPaid(row.id)}
                            disabled={markingId === row.id}
                            title="Marcar como pago (baixa manual)"
                          >
                            <CheckCircle className="mr-1 h-4 w-4" />
                            {markingId === row.id ? "..." : "Baixar"}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {payables && payables.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {payables.page} de {payables.totalPages} (
            {payables.total} registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={payables.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={payables.page >= payables.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próximo
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar Conta a Pagar" : "Nova Conta a Pagar"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Atualize os dados da conta a pagar."
                : "Cadastre uma nova conta a pagar para a empresa."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier">Fornecedor *</Label>
              <Input
                id="supplier"
                value={formSupplier}
                onChange={(e) => setFormSupplier(e.target.value)}
                required
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição *</Label>
              <Input
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                required
                disabled={saving}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="value">Valor (R$) *</Label>
                <Input
                  id="value"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  required
                  disabled={saving}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dueDate">Data de Vencimento *</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  required
                  disabled={saving}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select
                  value={formCategoryId || "__none__"}
                  onValueChange={(v) =>
                    setFormCategoryId(v === "__none__" ? "" : v)
                  }
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhuma</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Recorrência</Label>
                <Select
                  value={formRecurrence}
                  onValueChange={setFormRecurrence}
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Nenhuma</SelectItem>
                    <SelectItem value="WEEKLY">Semanal</SelectItem>
                    <SelectItem value="MONTHLY">Mensal</SelectItem>
                    <SelectItem value="YEARLY">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
    </div>
  );
}
