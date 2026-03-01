"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Filter,
  Pencil,
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
import { useCompany } from "@/contexts/company-context";
import {
  listProposals,
  listClientsForProposal,
  type PaginatedResult,
  type ProposalRow,
  type ClientOption,
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
    case "DRAFT":
      return "Rascunho";
    case "SENT":
      return "Enviada";
    case "ACCEPTED":
      return "Aceita";
    case "REJECTED":
      return "Rejeitada";
    case "EXPIRED":
      return "Expirada";
    default:
      return status;
  }
}

function statusColor(status: string) {
  switch (status) {
    case "DRAFT":
      return "bg-gray-100 text-gray-800";
    case "SENT":
      return "bg-blue-100 text-blue-800";
    case "ACCEPTED":
      return "bg-green-100 text-green-800";
    case "REJECTED":
      return "bg-red-100 text-red-800";
    case "EXPIRED":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PropostasPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompany();

  const [proposals, setProposals] =
    useState<PaginatedResult<ProposalRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClientId, setFilterClientId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterValueMin, setFilterValueMin] = useState("");
  const [filterValueMax, setFilterValueMax] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Clients for filter dropdown
  const [clients, setClients] = useState<ClientOption[]>([]);

  const hasActiveFilters =
    filterStatus !== "" ||
    filterClientId !== "" ||
    filterDateFrom !== "" ||
    filterDateTo !== "" ||
    filterValueMin !== "" ||
    filterValueMax !== "";

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadProposals = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await listProposals({
        companyId: selectedCompanyId,
        page,
        status: filterStatus
          ? (filterStatus as "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED")
          : undefined,
        clientId: filterClientId || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        valueMin: filterValueMin ? parseFloat(filterValueMin) : undefined,
        valueMax: filterValueMax ? parseFloat(filterValueMax) : undefined,
      });
      setProposals(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar propostas"
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
    filterValueMin,
    filterValueMax,
  ]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  // Load clients for filter dropdown
  useEffect(() => {
    if (!selectedCompanyId) return;
    listClientsForProposal(selectedCompanyId).then(setClients).catch(() => {});
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
    setFilterValueMin("");
    setFilterValueMax("");
    setPage(1);
  }

  // ---------------------------------------------------
  // Row click — navigate to edit (draft) or view
  // ---------------------------------------------------

  function handleRowClick(row: ProposalRow) {
    if (row.status === "DRAFT") {
      router.push(`/comercial/propostas/nova?edit=${row.id}`);
    } else {
      router.push(`/comercial/propostas/nova?edit=${row.id}`);
    }
  }

  // ---------------------------------------------------
  // No company selected
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar as propostas.
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
          <h1 className="text-2xl font-bold tracking-tight">Propostas</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie as propostas comerciais da empresa
          </p>
        </div>
        <Button onClick={() => router.push("/comercial/propostas/nova")}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Proposta
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
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3">
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
                <SelectItem value="DRAFT">Rascunho</SelectItem>
                <SelectItem value="SENT">Enviada</SelectItem>
                <SelectItem value="ACCEPTED">Aceita</SelectItem>
                <SelectItem value="REJECTED">Rejeitada</SelectItem>
                <SelectItem value="EXPIRED">Expirada</SelectItem>
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

          <div className="space-y-2">
            <Label>Valor mínimo</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="R$ 0,00"
              value={filterValueMin}
              onChange={(e) => {
                setFilterValueMin(e.target.value);
                handleFilterChange();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Valor máximo</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="R$ 0,00"
              value={filterValueMax}
              onChange={(e) => {
                setFilterValueMax(e.target.value);
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
              <TableHead className="text-right">Valor Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Data</TableHead>
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
            ) : !proposals?.data.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Nenhuma proposta encontrada.
                </TableCell>
              </TableRow>
            ) : (
              proposals.data.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(row)}
                >
                  <TableCell className="font-medium">
                    {row.clientName}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currencyFmt.format(parseFloat(row.totalValue))}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRowClick(row);
                      }}
                      title={
                        row.status === "DRAFT"
                          ? "Editar proposta"
                          : "Visualizar proposta"
                      }
                    >
                      <Pencil className="mr-1 h-4 w-4" />
                      {row.status === "DRAFT" ? "Editar" : "Ver"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {proposals && proposals.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {proposals.page} de {proposals.totalPages} (
            {proposals.total} registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={proposals.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={proposals.page >= proposals.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próximo
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
