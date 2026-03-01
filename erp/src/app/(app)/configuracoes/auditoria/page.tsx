"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  X,
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
  listAuditLogs,
  exportAuditLogsCsv,
  getAuditEntityTypes,
  getAuditUsers,
  getAuditCompanies,
  type AuditLogEntry,
  type PaginatedResult,
  type ListAuditLogsParams,
} from "./actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_TYPES = [
  { value: "CREATE", label: "Criar" },
  { value: "UPDATE", label: "Atualizar" },
  { value: "DELETE", label: "Excluir" },
  { value: "LOGIN", label: "Login" },
  { value: "LOGOUT", label: "Logout" },
  { value: "STATUS_CHANGE", label: "Alterar Status" },
];

const ACTION_BADGE_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  LOGIN: "bg-purple-100 text-purple-800",
  LOGOUT: "bg-gray-100 text-gray-800",
  STATUS_CHANGE: "bg-yellow-100 text-yellow-800",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<PaginatedResult<AuditLogEntry> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [filterUserId, setFilterUserId] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Filter options
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [companies, setCompanies] = useState<
    { id: string; nomeFantasia: string }[]
  >([]);

  // Load filter options on mount
  useEffect(() => {
    async function loadFilterOptions() {
      try {
        const [u, e, c] = await Promise.all([
          getAuditUsers(),
          getAuditEntityTypes(),
          getAuditCompanies(),
        ]);
        setUsers(u);
        setEntities(e);
        setCompanies(c);
      } catch {
        // Filter options are optional — silently fail
      }
    }
    loadFilterOptions();
  }, []);

  // Build filter params
  const buildParams = useCallback((): ListAuditLogsParams => {
    const params: ListAuditLogsParams = { page };
    if (filterUserId) params.userId = filterUserId;
    if (filterAction) params.action = filterAction;
    if (filterEntity) params.entity = filterEntity;
    if (filterCompanyId) params.companyId = filterCompanyId;
    if (filterDateFrom) params.dateFrom = filterDateFrom;
    if (filterDateTo) params.dateTo = filterDateTo;
    return params;
  }, [page, filterUserId, filterAction, filterEntity, filterCompanyId, filterDateFrom, filterDateTo]);

  // Load audit logs
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAuditLogs(buildParams());
      setLogs(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar logs de auditoria"
      );
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Clear all filters
  function clearFilters() {
    setFilterUserId("");
    setFilterAction("");
    setFilterEntity("");
    setFilterCompanyId("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
  }

  const hasActiveFilters =
    filterUserId || filterAction || filterEntity || filterCompanyId || filterDateFrom || filterDateTo;

  // CSV export
  async function handleExport() {
    setExporting(true);
    try {
      const csv = await exportAuditLogsCsv(buildParams());
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Exportação concluída");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao exportar logs"
      );
    } finally {
      setExporting(false);
    }
  }

  // Format date/time
  function formatDateTime(date: Date): string {
    return new Date(date).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  // Action label in Portuguese
  function getActionLabel(action: string): string {
    return ACTION_TYPES.find((a) => a.value === action)?.label ?? action;
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Auditoria</h1>
          <p className="text-sm text-muted-foreground">
            Visualize e exporte os logs de atividade do sistema
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="mr-2 h-4 w-4" />
            Filtros
            {hasActiveFilters && (
              <span className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                !
              </span>
            )}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Exportando..." : "Exportar CSV"}
          </Button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="rounded-md border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Filtros</h3>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-3 w-3" />
                Limpar filtros
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* User filter */}
            <div className="space-y-2">
              <Label>Usuário</Label>
              <Select value={filterUserId} onValueChange={(v) => { setFilterUserId(v === "__all__" ? "" : v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os usuários" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos os usuários</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action filter */}
            <div className="space-y-2">
              <Label>Ação</Label>
              <Select value={filterAction} onValueChange={(v) => { setFilterAction(v === "__all__" ? "" : v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as ações" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas as ações</SelectItem>
                  {ACTION_TYPES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity filter */}
            <div className="space-y-2">
              <Label>Entidade</Label>
              <Select value={filterEntity} onValueChange={(v) => { setFilterEntity(v === "__all__" ? "" : v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as entidades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas as entidades</SelectItem>
                  {entities.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Company filter */}
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Select value={filterCompanyId} onValueChange={(v) => { setFilterCompanyId(v === "__all__" ? "" : v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as empresas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas as empresas</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nomeFantasia}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date from */}
            <div className="space-y-2">
              <Label>Data início</Label>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
              />
            </div>

            {/* Date to */}
            <div className="space-y-2">
              <Label>Data fim</Label>
              <Input
                type="date"
                value={filterDateTo}
                onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/Hora</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Entidade</TableHead>
              <TableHead>Empresa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : !logs?.data.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Nenhum registro de auditoria encontrado.
                </TableCell>
              </TableRow>
            ) : (
              logs.data.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(log.createdAt)}
                  </TableCell>
                  <TableCell>{log.userName}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        ACTION_BADGE_COLORS[log.action] ?? "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {getActionLabel(log.action)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{log.entity}</span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      #{log.entityId.slice(0, 8)}
                    </span>
                  </TableCell>
                  <TableCell>{log.companyName ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {logs && logs.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {logs.page} de {logs.totalPages} ({logs.total} registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={logs.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={logs.page >= logs.totalPages}
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
