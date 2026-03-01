"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  XCircle,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  listInvoices,
  listClientsForSelect,
  cancelInvoice,
  type PaginatedResult,
  type InvoiceRow,
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
    case "ISSUED":
      return "Emitida";
    case "CANCELLED":
      return "Cancelada";
    default:
      return "Pendente";
  }
}

function statusColor(status: string) {
  switch (status) {
    case "ISSUED":
      return "bg-green-100 text-green-800";
    case "CANCELLED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NotasFiscaisPage() {
  const { selectedCompanyId } = useCompany();

  const [invoices, setInvoices] =
    useState<PaginatedResult<InvoiceRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClientId, setFilterClientId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Clients for filter
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);

  // Cancel dialog
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const hasActiveFilters =
    filterStatus !== "" ||
    filterClientId !== "" ||
    filterDateFrom !== "" ||
    filterDateTo !== "";

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadInvoices = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await listInvoices({
        companyId: selectedCompanyId,
        page,
        status: filterStatus
          ? (filterStatus as "PENDING" | "ISSUED" | "CANCELLED")
          : undefined,
        clientId: filterClientId || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
      });
      setInvoices(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar notas fiscais"
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
    loadInvoices();
  }, [loadInvoices]);

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
  // Cancel invoice
  // ---------------------------------------------------

  function openCancelDialog(id: string) {
    setCancellingId(id);
    setCancelDialogOpen(true);
  }

  async function handleCancelInvoice() {
    if (!selectedCompanyId || !cancellingId) return;

    setCancelling(true);
    try {
      await cancelInvoice(cancellingId, selectedCompanyId);
      toast.success("Nota fiscal cancelada com sucesso");
      setCancelDialogOpen(false);
      setCancellingId(null);
      await loadInvoices();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao cancelar nota fiscal"
      );
    } finally {
      setCancelling(false);
    }
  }

  // ---------------------------------------------------
  // No company selected
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar as notas fiscais.
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
          <h1 className="text-2xl font-bold tracking-tight">Notas Fiscais</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie as notas fiscais de serviço (NFS-e) da empresa
          </p>
        </div>
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
                <SelectItem value="ISSUED">Emitida</SelectItem>
                <SelectItem value="CANCELLED">Cancelada</SelectItem>
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
            <Label>Data de</Label>
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
            <Label>Data até</Label>
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
              <TableHead>Nº NF</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Data</TableHead>
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
            ) : !invoices?.data.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  Nenhuma nota fiscal encontrada.
                </TableCell>
              </TableRow>
            ) : (
              invoices.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-sm">
                    {row.nfNumber || "—"}
                  </TableCell>
                  <TableCell className="font-medium">
                    {row.client.name}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={row.serviceDescription}>
                    {row.serviceDescription}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currencyFmt.format(parseFloat(row.value))}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(row.status)}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {dateFmt.format(new Date(row.createdAt))}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === "ISSUED" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openCancelDialog(row.id)}
                        title="Cancelar nota fiscal"
                      >
                        <XCircle className="mr-1 h-4 w-4" />
                        Cancelar
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
      {invoices && invoices.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {invoices.page} de {invoices.totalPages} (
            {invoices.total} registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={invoices.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={invoices.page >= invoices.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próximo
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      <Dialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          setCancelDialogOpen(open);
          if (!open) setCancellingId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar Nota Fiscal</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja cancelar esta nota fiscal? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCancelDialogOpen(false);
                setCancellingId(null);
              }}
              disabled={cancelling}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelInvoice}
              disabled={cancelling}
            >
              {cancelling ? "Cancelando..." : "Confirmar Cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
