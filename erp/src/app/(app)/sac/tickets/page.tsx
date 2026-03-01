"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  listTickets,
  createTicket,
  listClientsForSelect,
  listUsersForAssign,
  type PaginatedResult,
  type TicketRow,
} from "./actions";
import type { TicketStatus, TicketPriority } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function priorityLabel(p: string) {
  switch (p) {
    case "HIGH":
      return "Alta";
    case "LOW":
      return "Baixa";
    default:
      return "Média";
  }
}

function priorityColor(p: string) {
  switch (p) {
    case "HIGH":
      return "bg-red-100 text-red-800";
    case "LOW":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-yellow-100 text-yellow-800";
  }
}

function statusLabel(s: string) {
  switch (s) {
    case "OPEN":
      return "Aberto";
    case "IN_PROGRESS":
      return "Em Andamento";
    case "WAITING_CLIENT":
      return "Aguardando Cliente";
    case "RESOLVED":
      return "Resolvido";
    case "CLOSED":
      return "Fechado";
    default:
      return s;
  }
}

function statusColor(s: string) {
  switch (s) {
    case "OPEN":
      return "bg-blue-100 text-blue-800";
    case "IN_PROGRESS":
      return "bg-yellow-100 text-yellow-800";
    case "WAITING_CLIENT":
      return "bg-orange-100 text-orange-800";
    case "RESOLVED":
      return "bg-green-100 text-green-800";
    case "CLOSED":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TicketsPage() {
  const { selectedCompanyId } = useCompany();

  const [tickets, setTickets] =
    useState<PaginatedResult<TicketRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterClientId, setFilterClientId] = useState("");
  const [filterAssigneeId, setFilterAssigneeId] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Dropdown data
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formClientId, setFormClientId] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriority, setFormPriority] = useState<TicketPriority>("MEDIUM");
  const [formAssigneeId, setFormAssigneeId] = useState("");

  const hasActiveFilters =
    filterStatus !== "" ||
    filterPriority !== "" ||
    filterClientId !== "" ||
    filterAssigneeId !== "";

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadTickets = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await listTickets({
        companyId: selectedCompanyId,
        page,
        status: filterStatus ? (filterStatus as TicketStatus) : undefined,
        priority: filterPriority
          ? (filterPriority as TicketPriority)
          : undefined,
        clientId: filterClientId || undefined,
        assigneeId: filterAssigneeId || undefined,
      });
      setTickets(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar tickets"
      );
    } finally {
      setLoading(false);
    }
  }, [
    selectedCompanyId,
    page,
    filterStatus,
    filterPriority,
    filterClientId,
    filterAssigneeId,
  ]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Load dropdown data
  useEffect(() => {
    if (!selectedCompanyId) return;
    listClientsForSelect(selectedCompanyId).then(setClients).catch(() => {});
    listUsersForAssign(selectedCompanyId).then(setUsers).catch(() => {});
  }, [selectedCompanyId]);

  // ---------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------

  function handleFilterChange() {
    setPage(1);
  }

  function clearFilters() {
    setFilterStatus("");
    setFilterPriority("");
    setFilterClientId("");
    setFilterAssigneeId("");
    setPage(1);
  }

  // ---------------------------------------------------
  // Create dialog
  // ---------------------------------------------------

  function openCreateDialog() {
    setFormClientId("");
    setFormSubject("");
    setFormDescription("");
    setFormPriority("MEDIUM");
    setFormAssigneeId("");
    setFormError("");
    setDialogOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId) return;
    setFormError("");
    setSaving(true);

    try {
      await createTicket({
        companyId: selectedCompanyId,
        clientId: formClientId,
        subject: formSubject,
        description: formDescription,
        priority: formPriority,
        assigneeId: formAssigneeId || undefined,
      });
      toast.success("Ticket criado com sucesso");
      setDialogOpen(false);
      await loadTickets();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao criar ticket"
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------
  // No company selected
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar os tickets.
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
          <h1 className="text-2xl font-bold tracking-tight">Tickets SAC</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os tickets de atendimento ao cliente
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Ticket
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
                <SelectItem value="OPEN">Aberto</SelectItem>
                <SelectItem value="IN_PROGRESS">Em Andamento</SelectItem>
                <SelectItem value="WAITING_CLIENT">
                  Aguardando Cliente
                </SelectItem>
                <SelectItem value="RESOLVED">Resolvido</SelectItem>
                <SelectItem value="CLOSED">Fechado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Prioridade</Label>
            <Select
              value={filterPriority || "__all__"}
              onValueChange={(v) => {
                setFilterPriority(v === "__all__" ? "" : v);
                handleFilterChange();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                <SelectItem value="HIGH">Alta</SelectItem>
                <SelectItem value="MEDIUM">Média</SelectItem>
                <SelectItem value="LOW">Baixa</SelectItem>
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
            <Label>Responsável</Label>
            <Select
              value={filterAssigneeId || "__all__"}
              onValueChange={(v) => {
                setFilterAssigneeId(v === "__all__" ? "" : v);
                handleFilterChange();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : !tickets?.data.length ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Nenhum ticket encontrado.
                </TableCell>
              </TableRow>
            ) : (
              tickets.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.client.name}
                  </TableCell>
                  <TableCell>{row.subject}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${priorityColor(row.priority)}`}
                    >
                      {priorityLabel(row.priority)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(row.status)}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.assignee?.name ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {dateFmt.format(new Date(row.createdAt))}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {tickets && tickets.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {tickets.page} de {tickets.totalPages} ({tickets.total}{" "}
            registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={tickets.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={tickets.page >= tickets.totalPages}
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
            <DialogTitle>Novo Ticket</DialogTitle>
            <DialogDescription>
              Abra um novo ticket de atendimento ao cliente.
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
              <Label htmlFor="subject">Assunto *</Label>
              <Input
                id="subject"
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                required
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição *</Label>
              <Textarea
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={4}
                required
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Prioridade</Label>
              <Select
                value={formPriority}
                onValueChange={(v) => setFormPriority(v as TicketPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HIGH">Alta</SelectItem>
                  <SelectItem value="MEDIUM">Média</SelectItem>
                  <SelectItem value="LOW">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="assigneeId">Responsável</Label>
              <Select
                value={formAssigneeId || "__none__"}
                onValueChange={(v) =>
                  setFormAssigneeId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
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
                {saving ? "Salvando..." : "Criar Ticket"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
