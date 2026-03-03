"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Filter,
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
  listReceivables,
  createReceivable,
  markReceivableAsPaid,
  listClientsForSelect,
  type PaginatedResult,
  type ReceivableRow,
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
    case "CANCELLED":
      return "Cancelado";
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
    case "CANCELLED":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContasReceberPage() {
  const { selectedCompanyId } = useCompany();

  const [receivables, setReceivables] =
    useState<PaginatedResult<ReceivableRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClientId, setFilterClientId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Clients for filter/form
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formClientId, setFormClientId] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDueDate, setFormDueDate] = useState("");

  // Mark as paid
  const [markingId, setMarkingId] = useState<string | null>(null);

  const hasActiveFilters =
    filterStatus !== "" ||
    filterClientId !== "" ||
    filterDateFrom !== "" ||
    filterDateTo !== "";

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadReceivables = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await listReceivables({
        companyId: selectedCompanyId,
        page,
        status: filterStatus
          ? (filterStatus as "PENDING" | "PAID" | "OVERDUE")
          : undefined,
        clientId: filterClientId || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
      });
      setReceivables(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar contas a receber"
      );
    } finally {
      setLoading(false);
    }
  }, [
    selectedCompanyId,
    page,
    filterStatus,
    filterClientId,
    filterDateFrom,
    filterDateTo,
  ]);

  useEffect(() => {
    loadReceivables();
  }, [loadReceivables]);

  // Load clients for dropdown
  useEffect(() => {
    if (!selectedCompanyId) return;
    listClientsForSelect(selectedCompanyId).then(setClients).catch(() => {});
  }, [selectedCompanyId]);

  // ---------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------

  function handleFilterChange() {
    setPage(1);
  }

  function clearFilters() {
    setFilterStatus("");
    setFilterClientId("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
  }

  // ---------------------------------------------------
  // Create dialog
  // ---------------------------------------------------

  function openCreateDialog() {
    setFormClientId("");
    setFormDescription("");
    setFormValue("");
    setFormDueDate("");
    setFormError("");
    setDialogOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId) return;
    setFormError("");
    setSaving(true);

    try {
      await createReceivable({
        companyId: selectedCompanyId,
        clientId: formClientId,
        description: formDescription,
        value: parseFloat(formValue),
        dueDate: formDueDate,
      });
      toast.success("Conta a receber criada com sucesso");
      setDialogOpen(false);
      await loadReceivables();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao criar conta a receber"
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
      await markReceivableAsPaid(id, selectedCompanyId);
      toast.success("Conta marcada como paga");
      await loadReceivables();
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
        Selecione uma empresa para visualizar as contas a receber.
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
            Contas a Receber
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie as contas a receber da empresa
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Conta a Receber
        </Button>
      </div>

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
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <Label>Cliente</Label>
            <Select
              value={filterClientId || "__all__"}
              onValueChange={(v) => {
                setFilterClientId(v === "__all__" ? "" : v);
                handleFilterChange();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {clients.map((c) => (
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
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : !receivables?.data.length ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Nenhuma conta a receber encontrada.
                </TableCell>
              </TableRow>
            ) : (
              receivables.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.client.name}
                  </TableCell>
                  <TableCell>{row.description}</TableCell>
                  <TableCell className="text-right font-mono">
                    {currencyFmt.format(parseFloat(row.value))}
                  </TableCell>
                  <TableCell>
                    {dateFmt.format(new Date(row.dueDate))}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(row.status)}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status !== "PAID" && row.status !== "CANCELLED" && (
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
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {receivables && receivables.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {receivables.page} de {receivables.totalPages} (
            {receivables.total} registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={receivables.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={receivables.page >= receivables.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próximo
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Conta a Receber</DialogTitle>
            <DialogDescription>
              Cadastre uma nova conta a receber para a empresa.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clientId">Cliente *</Label>
              <Select
                value={formClientId || "__none__"}
                onValueChange={(v) =>
                  setFormClientId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" disabled>
                    Selecione um cliente
                  </SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                {saving ? "Salvando..." : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
