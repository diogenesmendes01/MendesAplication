"use client";

import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  Upload,
  ChevronLeft,
  ChevronRight,
  Filter,
  Trash2,
  FileSpreadsheet,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/contexts/company-context";
import {
  listBankTransactions,
  importBankTransactions,
  deleteBankTransaction,
  type PaginatedResult,
  type BankTransactionRow,
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
    case "RECONCILED":
      return "Conciliado";
    default:
      return "Pendente";
  }
}

function statusColor(status: string) {
  switch (status) {
    case "RECONCILED":
      return "bg-green-100 text-green-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BankReconciliationPage() {
  const { selectedCompanyId } = useCompany();

  // Data state
  const [result, setResult] = useState<PaginatedResult<BankTransactionRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  const hasActiveFilters = filterStatus || filterDateFrom || filterDateTo || filterSearch;

  // -------------------------------------------------------------------------
  // Load data
  // -------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const data = await listBankTransactions({
        companyId: selectedCompanyId,
        page,
        status: filterStatus as "PENDING" | "RECONCILED" | undefined || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        search: filterSearch || undefined,
      });
      setResult(data);
    } catch {
      toast.error("Erro ao carregar transações bancárias");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, page, filterStatus, filterDateFrom, filterDateTo, filterSearch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset page when company or filters change
  useEffect(() => {
    setPage(1);
  }, [selectedCompanyId, filterStatus, filterDateFrom, filterDateTo, filterSearch]);

  // -------------------------------------------------------------------------
  // File Import
  // -------------------------------------------------------------------------

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedCompanyId) return;

    setImporting(true);
    try {
      const content = await file.text();
      const result = await importBankTransactions(selectedCompanyId, content, file.name);

      if (result.imported > 0) {
        toast.success(
          `${result.imported} transação(ões) importada(s) com sucesso.${
            result.skipped > 0 ? ` ${result.skipped} ignorada(s).` : ""
          }`
        );
      } else if (result.errors.length > 0) {
        toast.error(result.errors[0]);
      } else {
        toast.warning("Nenhuma transação encontrada no arquivo.");
      }

      loadData();
    } catch {
      toast.error("Erro ao importar arquivo");
    } finally {
      setImporting(false);
      // Reset file input so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  async function handleDelete(id: string) {
    if (!selectedCompanyId) return;
    try {
      await deleteBankTransaction(id, selectedCompanyId);
      toast.success("Transação excluída");
      loadData();
    } catch {
      toast.error("Erro ao excluir transação");
    }
  }

  // -------------------------------------------------------------------------
  // Clear filters
  // -------------------------------------------------------------------------

  function clearFilters() {
    setFilterStatus("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterSearch("");
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Conciliação Bancária</h1>
        <p className="text-muted-foreground">Selecione uma empresa para continuar.</p>
      </div>
    );
  }

  const transactions = result?.data ?? [];
  const totalPages = result?.totalPages ?? 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Conciliação Bancária</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-1" />
            Filtros
            {hasActiveFilters && (
              <span className="ml-1 bg-primary text-primary-foreground rounded-full w-5 h-5 text-xs flex items-center justify-center">
                !
              </span>
            )}
          </Button>
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <Upload className="h-4 w-4 mr-1" />
            {importing ? "Importando..." : "Importar Arquivo"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ofx,.qfx,.csv,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Import instructions card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Importar Extrato Bancário
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Importe extratos bancários nos formatos <strong>OFX</strong> ou <strong>CSV</strong>.
            Para CSV, o arquivo deve conter colunas de data, descrição e valor
            (com cabeçalho na primeira linha).
          </p>
        </CardContent>
      </Card>

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label>Status</Label>
                <Select
                  value={filterStatus || "__all__"}
                  onValueChange={(v) => setFilterStatus(v === "__all__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    <SelectItem value="PENDING">Pendente</SelectItem>
                    <SelectItem value="RECONCILED">Conciliado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Buscar descrição</Label>
                <Input
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder="Buscar..."
                />
              </div>

              <div>
                <Label>Data de</Label>
                <Input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                />
              </div>

              <div>
                <Label>Data até</Label>
                <Input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                />
              </div>
            </div>

            {hasActiveFilters && (
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Transactions table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Nenhuma transação encontrada. Importe um extrato bancário para começar.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((t) => {
                const value = parseFloat(t.value);
                const isNegative = value < 0;

                return (
                  <TableRow key={t.id}>
                    <TableCell>{dateFmt.format(new Date(t.date))}</TableCell>
                    <TableCell className="max-w-[300px] truncate" title={t.description}>
                      {t.description}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        isNegative ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {currencyFmt.format(value)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor(
                          t.status
                        )}`}
                      >
                        {statusLabel(t.status)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {t.status === "PENDING" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(t.id)}
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {result && result.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {result.total} transação(ões) encontrada(s)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
