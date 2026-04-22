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
  Wand2,
  Link2,
  Unlink,
  CheckCircle2,
  AlertCircle,
  BarChart3,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/company-context";
import {
  listBankTransactions,
  importBankTransactions,
  deleteBankTransaction,
  getReconciliationSummary,
  listUnmatchedSystemRecords,
  autoMatchTransactions,
  manualMatchTransaction,
  unmatchTransaction,
  type PaginatedResult,
  type BankTransactionRow,
  type SystemRecordRow,
  type ReconciliationSummary,
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

function systemRecordTypeLabel(type: string) {
  return type === "RECEIVABLE" ? "A Receber" : "A Pagar";
}

function systemRecordTypeColor(type: string) {
  return type === "RECEIVABLE"
    ? "bg-blue-100 text-blue-800"
    : "bg-orange-100 text-orange-800";
}

function paymentStatusLabel(status: string) {
  switch (status) {
    case "PAID":
      return "Pago";
    case "OVERDUE":
      return "Vencido";
    default:
      return "Pendente";
  }
}

// ---------------------------------------------------------------------------
// Import Tab
// ---------------------------------------------------------------------------

function ImportTab({
  selectedCompanyId,
  onDataChanged,
}: {
  selectedCompanyId: string;
  onDataChanged: () => void;
}) {
  const [result, setResult] = useState<PaginatedResult<BankTransactionRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  const hasActiveFilters = filterStatus || filterDateFrom || filterDateTo || filterSearch;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listBankTransactions({
        companyId: selectedCompanyId,
        page,
        status: (filterStatus as "PENDING" | "RECONCILED") || undefined,
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

  useEffect(() => {
    setPage(1);
  }, [selectedCompanyId, filterStatus, filterDateFrom, filterDateTo, filterSearch]);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const content = await file.text();
      const res = await importBankTransactions(selectedCompanyId, content, file.name);

      if (res.imported > 0) {
        toast.success(
          `${res.imported} transação(ões) importada(s) com sucesso.${
            res.skipped > 0 ? ` ${res.skipped} ignorada(s).` : ""
          }`
        );
      } else if (res.errors.length > 0) {
        toast.error(res.errors[0]);
      } else {
        toast.warning("Nenhuma transação encontrada no arquivo.");
      }

      loadData();
      onDataChanged();
    } catch {
      toast.error("Erro ao importar arquivo");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBankTransaction(id, selectedCompanyId);
      toast.success("Transação excluída");
      loadData();
      onDataChanged();
    } catch {
      toast.error("Erro ao excluir transação");
    }
  }

  function clearFilters() {
    setFilterStatus("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterSearch("");
  }

  const transactions = result?.data ?? [];
  const totalPages = result?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
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
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor(t.status)}`}
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

// ---------------------------------------------------------------------------
// Matching Tab
// ---------------------------------------------------------------------------

function MatchingTab({
  selectedCompanyId,
  summary,
  onDataChanged,
}: {
  selectedCompanyId: string;
  summary: ReconciliationSummary | null;
  onDataChanged: () => void;
}) {
  const [pendingTxns, setPendingTxns] = useState<BankTransactionRow[]>([]);
  const [reconciledTxns, setReconciledTxns] = useState<BankTransactionRow[]>([]);
  const [systemRecords, setSystemRecords] = useState<SystemRecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);

  // Manual match dialog
  const [manualMatchTxn, setManualMatchTxn] = useState<BankTransactionRow | null>(null);
  const [manualMatchFilter, setManualMatchFilter] = useState("");

  const loadMatchingData = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingResult, reconciledResult, records] = await Promise.all([
        listBankTransactions({ companyId: selectedCompanyId, status: "PENDING", pageSize: 100 }),
        listBankTransactions({ companyId: selectedCompanyId, status: "RECONCILED", pageSize: 100 }),
        listUnmatchedSystemRecords(selectedCompanyId),
      ]);
      setPendingTxns(pendingResult.data);
      setReconciledTxns(reconciledResult.data);
      setSystemRecords(records);
    } catch {
      toast.error("Erro ao carregar dados de conciliação");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadMatchingData();
  }, [loadMatchingData]);

  async function handleAutoMatch() {
    setAutoMatching(true);
    try {
      const res = await autoMatchTransactions(selectedCompanyId);
      if (res.matched > 0) {
        toast.success(`${res.matched} transação(ões) conciliada(s) automaticamente!`);
      } else {
        toast.info("Nenhuma correspondência automática encontrada.");
      }
      loadMatchingData();
      onDataChanged();
    } catch {
      toast.error("Erro na conciliação automática");
    } finally {
      setAutoMatching(false);
    }
  }

  async function handleManualMatch(
    matchedType: "RECEIVABLE" | "PAYABLE",
    matchedEntityId: string
  ) {
    if (!manualMatchTxn) return;
    try {
      await manualMatchTransaction(manualMatchTxn.id, matchedType, matchedEntityId, selectedCompanyId);
      toast.success("Transação conciliada manualmente!");
      setManualMatchTxn(null);
      setManualMatchFilter("");
      loadMatchingData();
      onDataChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao conciliar");
    }
  }

  async function handleUnmatch(bankTransactionId: string) {
    try {
      await unmatchTransaction(bankTransactionId, selectedCompanyId);
      toast.success("Conciliação desfeita");
      loadMatchingData();
      onDataChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao desfazer conciliação");
    }
  }

  // Filter system records for manual match dialog
  const filteredRecords = systemRecords.filter((r) => {
    if (!manualMatchFilter) return true;
    const q = manualMatchFilter.toLowerCase();
    return (
      r.description.toLowerCase().includes(q) ||
      r.clientOrSupplier.toLowerCase().includes(q) ||
      r.value.includes(q)
    );
  });

  // Find the matched system record info for reconciled transactions
  function getMatchedRecordLabel(txn: BankTransactionRow): string {
    if (!txn.matchedType || !txn.matchedEntityId) return "—";
    const typeLabel = txn.matchedType === "RECEIVABLE" ? "Receber" : "Pagar";
    return `${typeLabel}: ${txn.matchedEntityId.substring(0, 8)}...`;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Total de Transações</p>
              </div>
              <p className="text-2xl font-bold">{summary.totalBankTransactions}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <p className="text-sm text-muted-foreground">Conciliadas</p>
              </div>
              <p className="text-2xl font-bold text-green-600">{summary.matched}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <p className="text-sm text-muted-foreground">Não Conciliadas</p>
              </div>
              <p className="text-2xl font-bold text-yellow-600">{summary.unmatched}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-blue-500" />
                <p className="text-sm text-muted-foreground">% Conciliação</p>
              </div>
              <p className="text-2xl font-bold text-blue-600">{summary.reconciliationPercentage}%</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Auto-match button */}
      <div className="flex items-center justify-end">
        <Button onClick={handleAutoMatch} disabled={autoMatching || loading}>
          <Wand2 className="h-4 w-4 mr-1" />
          {autoMatching ? "Conciliando..." : "Conciliação Automática"}
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Unmatched Bank Transactions */}
          <div>
            <h3 className="text-lg font-semibold mb-3">
              Transações Bancárias Pendentes ({pendingTxns.length})
            </h3>
            <div className="border rounded-lg max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-[80px]">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingTxns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        Nenhuma transação pendente
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingTxns.map((t) => {
                      const value = parseFloat(t.value);
                      const isNegative = value < 0;
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="text-sm">{dateFmt.format(new Date(t.date))}</TableCell>
                          <TableCell className="text-sm max-w-[150px] truncate" title={t.description}>
                            {t.description}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono text-sm ${
                              isNegative ? "text-red-600" : "text-green-600"
                            }`}
                          >
                            {currencyFmt.format(value)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => setManualMatchTxn(t)}
                              title="Conciliar manualmente"
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Right: Unmatched System Records */}
          <div>
            <h3 className="text-lg font-semibold mb-3">
              Registros do Sistema ({systemRecords.length})
            </h3>
            <div className="border rounded-lg max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systemRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        Nenhum registro pendente
                      </TableCell>
                    </TableRow>
                  ) : (
                    systemRecords.map((r) => (
                      <TableRow key={`${r.type}-${r.id}`}>
                        <TableCell>
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${systemRecordTypeColor(r.type)}`}
                          >
                            {systemRecordTypeLabel(r.type)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm max-w-[150px] truncate" title={`${r.clientOrSupplier} - ${r.description}`}>
                          <span className="font-medium">{r.clientOrSupplier}</span>
                          <br />
                          <span className="text-muted-foreground">{r.description}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {currencyFmt.format(parseFloat(r.value))}
                        </TableCell>
                        <TableCell className="text-sm">
                          {dateFmt.format(new Date(r.dueDate))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* Reconciled Transactions */}
      {reconciledTxns.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">
            Transações Conciliadas ({reconciledTxns.length})
          </h3>
          <div className="border rounded-lg max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Conciliado com</TableHead>
                  <TableHead className="w-[80px]">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconciledTxns.map((t) => {
                  const value = parseFloat(t.value);
                  const isNegative = value < 0;
                  return (
                    <TableRow key={t.id} className="bg-green-50/50">
                      <TableCell className="text-sm">{dateFmt.format(new Date(t.date))}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={t.description}>
                        {t.description}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          isNegative ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {currencyFmt.format(value)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {getMatchedRecordLabel(t)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleUnmatch(t.id)}
                          title="Desfazer conciliação"
                        >
                          <Unlink className="h-4 w-4 text-yellow-600" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Manual Match Dialog */}
      <Dialog
        open={!!manualMatchTxn}
        onOpenChange={(open) => {
          if (!open) {
            setManualMatchTxn(null);
            setManualMatchFilter("");
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Conciliar Manualmente</DialogTitle>
          </DialogHeader>

          {manualMatchTxn && (
            <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
              {/* Selected bank transaction */}
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground mb-1">Transação Bancária</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{manualMatchTxn.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {dateFmt.format(new Date(manualMatchTxn.date))}
                      </p>
                    </div>
                    <p
                      className={`font-mono font-bold ${
                        parseFloat(manualMatchTxn.value) < 0 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {currencyFmt.format(parseFloat(manualMatchTxn.value))}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Search filter */}
              <Input
                placeholder="Buscar por descrição, cliente/fornecedor ou valor..."
                value={manualMatchFilter}
                onChange={(e) => setManualMatchFilter(e.target.value)}
              />

              {/* System records list */}
              <div className="border rounded-lg overflow-auto flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[80px]">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecords.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                          Nenhum registro encontrado
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRecords.map((r) => (
                        <TableRow key={`${r.type}-${r.id}`}>
                          <TableCell>
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${systemRecordTypeColor(r.type)}`}
                            >
                              {systemRecordTypeLabel(r.type)}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="font-medium">{r.clientOrSupplier}</span>
                            <br />
                            <span className="text-muted-foreground">{r.description}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {currencyFmt.format(parseFloat(r.value))}
                          </TableCell>
                          <TableCell className="text-sm">
                            {dateFmt.format(new Date(r.dueDate))}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs">{paymentStatusLabel(r.status)}</span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => handleManualMatch(r.type, r.id)}
                              title="Conciliar com este registro"
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function BankReconciliationPage() {
  const { selectedCompanyId } = useCompany();
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);

  const loadSummary = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const s = await getReconciliationSummary(selectedCompanyId);
      setSummary(s);
    } catch {
      // silently fail
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (!selectedCompanyId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Conciliação Bancária</h1>
        <p className="text-muted-foreground">Selecione uma empresa para continuar.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Conciliação Bancária</h1>

      <Tabs defaultValue="matching" className="w-full">
        <TabsList>
          <TabsTrigger value="matching">Conciliação</TabsTrigger>
          <TabsTrigger value="import">Importação</TabsTrigger>
        </TabsList>

        <TabsContent value="matching" className="mt-4">
          <MatchingTab
            selectedCompanyId={selectedCompanyId}
            summary={summary}
            onDataChanged={loadSummary}
          />
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          <ImportTab
            selectedCompanyId={selectedCompanyId}
            onDataChanged={loadSummary}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
