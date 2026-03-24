"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Search,
  Mail,
  MessageSquare,
  Globe,
  Tag,
  AlertTriangle,
  Bot,
  Star,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/company-context";
import {
  createTicket,
  listClientsForSelect,
  listUsersForAssign,
  getTicketListBootstrap,
  type PaginatedResult,
  type TicketRow,
  type TicketTab,
} from "./actions";
import type { ChannelType } from "@prisma/client";
import { TicketDashboardKpis } from "./ticket-dashboard";
import type { TicketPriority } from "@prisma/client";

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

function channelIcon(channelType: string | null) {
  switch (channelType) {
    case "EMAIL":
      return <Mail className="h-4 w-4 text-blue-600" />;
    case "WHATSAPP":
      return <MessageSquare className="h-4 w-4 text-green-600" />;
    case "RECLAMEAQUI":
      return null; // RA badge handles this
    default:
      return <Globe className="h-4 w-4 text-gray-500" />;
  }
}

function raStatusColor(statusName: string | null): string {
  switch (statusName) {
    case "Não respondido":
      return "bg-red-100 text-red-800";
    case "Respondido":
      return "bg-green-100 text-green-800";
    case "Réplica":
    case "Réplica consumidor":
    case "Réplica empresa":
      return "bg-yellow-100 text-yellow-800";
    case "Avaliado Resolvido":
      return "bg-emerald-100 text-emerald-800";
    case "Avaliado Não Resolvido":
      return "bg-red-100 text-red-800";
    case "Congelado":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function slaStatusColor(status: string | null) {
  switch (status) {
    case "ok":
      return "bg-green-100 text-green-800";
    case "at_risk":
      return "bg-yellow-100 text-yellow-800";
    case "breached":
      return "bg-red-100 text-red-800";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TicketsPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompany();

  const [tickets, setTickets] =
    useState<PaginatedResult<TicketRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Tabs & search
  const [activeTab, setActiveTab] = useState<TicketTab>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelType | "">("");
  const [pendingSuggestionFilter, setPendingSuggestionFilter] = useState(false);
  const [tabCounts, setTabCounts] = useState<{
    slaCritical: number;
    refunds: number;
  }>({ slaCritical: 0, refunds: 0 });
  const [slaAlerts, setSlaAlerts] = useState<{
    breached: number;
    atRisk: number;
  }>({ breached: 0, atRisk: 0 });

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

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadTickets = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const { tickets: result, tabCounts: counts, slaAlerts: alerts } =
        await getTicketListBootstrap({
          companyId: selectedCompanyId,
          page,
          tab: activeTab,
          search: search || undefined,
          channelType: channelFilter || undefined,
          hasPendingSuggestion: pendingSuggestionFilter || undefined,
        });
      setTickets(result);
      setTabCounts(counts);
      setSlaAlerts(alerts);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar tickets"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, page, activeTab, search, channelFilter, pendingSuggestionFilter]);

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
  // Search handler
  // ---------------------------------------------------

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  // ---------------------------------------------------
  // Tab change
  // ---------------------------------------------------

  function handleTabChange(value: string) {
    setActiveTab(value as TicketTab);
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

  const colSpan = 9;

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

      {/* Dashboard KPIs */}
      <TicketDashboardKpis companyId={selectedCompanyId} />

      {/* SLA Alert Banner */}
      {(slaAlerts.breached > 0 || slaAlerts.atRisk > 0) && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {slaAlerts.breached > 0 && (
              <span className="font-semibold text-red-700">
                {slaAlerts.breached} {slaAlerts.breached === 1 ? "estourado" : "estourados"}
              </span>
            )}
            {slaAlerts.breached > 0 && slaAlerts.atRisk > 0 && (
              <span className="text-red-400">|</span>
            )}
            {slaAlerts.atRisk > 0 && (
              <span className="font-semibold text-yellow-700">
                {slaAlerts.atRisk} em risco
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-red-300 text-red-700 hover:bg-red-100"
            onClick={() => {
              setActiveTab("sla_critical");
              setPage(1);
            }}
          >
            Ver SLA Crítico
          </Button>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
        >
          <TabsList>
            <TabsTrigger value="all">Todos</TabsTrigger>
            <TabsTrigger value="sla_critical" className="gap-1.5">
              SLA Crítico
              {tabCounts.slaCritical > 0 && (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
                  {tabCounts.slaCritical}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="refunds" className="gap-1.5">
              Reembolsos
              {tabCounts.refunds > 0 && (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white">
                  {tabCounts.refunds}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="my_tickets">Meus Tickets</TabsTrigger>
          </TabsList>
        </Tabs>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente ou assunto..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-64 pl-9"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Buscar
          </Button>
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setSearchInput("");
                setPage(1);
              }}
            >
              Limpar
            </Button>
          )}
        </form>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Canal:</Label>
          <Select
            value={channelFilter || "__all__"}
            onValueChange={(v) => {
              setChannelFilter(v === "__all__" ? "" : v as ChannelType);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[160px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              <SelectItem value="RECLAMEAQUI">Reclame Aqui</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="pending-suggestion"
            checked={pendingSuggestionFilter}
            onCheckedChange={(checked) => {
              setPendingSuggestionFilter(!!checked);
              setPage(1);
            }}
          />
          <Label htmlFor="pending-suggestion" className="text-sm cursor-pointer">
            <Bot className="inline h-4 w-4 mr-1" />
            Com sugestão pendente
          </Label>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">Canal</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : !tickets?.data.length ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center">
                  Nenhum ticket encontrado.
                </TableCell>
              </TableRow>
            ) : (
              tickets.data.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/sac/tickets/${row.id}`)}
                >
                  {/* Canal */}
                  <TableCell>
                    <div className="flex items-center gap-1.5" title={row.channelType ?? "Web"}>
                      {row.channelType === "RECLAMEAQUI" ? (
                        <Badge className="bg-purple-100 text-purple-800 text-[10px] px-1.5 py-0 font-bold">
                          RA
                        </Badge>
                      ) : (
                        channelIcon(row.channelType)
                      )}
                      {row.hasPendingSuggestion && (
                        <span title="Sugestão IA pendente" className="text-sm">🤖</span>
                      )}
                    </div>
                  </TableCell>
                  {/* Cliente */}
                  <TableCell className="font-medium">
                    {row.client.name}
                  </TableCell>
                  {/* Assunto */}
                  <TableCell className="max-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{row.subject}</span>
                      {row.channelType === "RECLAMEAQUI" && row.raRating && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-yellow-700 whitespace-nowrap" title="Nota RA">
                          <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                          {row.raRating}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  {/* Prioridade */}
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${priorityColor(row.priority)}`}
                    >
                      {priorityLabel(row.priority)}
                    </span>
                  </TableCell>
                  {/* Status */}
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(row.status)}`}
                      >
                        {statusLabel(row.status)}
                      </span>
                      {row.channelType === "RECLAMEAQUI" && row.raStatusName && (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${raStatusColor(row.raStatusName)}`}
                        >
                          {row.raStatusName}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  {/* SLA */}
                  <TableCell>
                    {row.slaStatus ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${slaStatusColor(row.slaStatus)}`}
                      >
                        {row.slaTimeLeft}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {/* Tags */}
                  <TableCell>
                    {row.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.tags.slice(0, 2).map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            <Tag className="mr-0.5 h-3 w-3" />
                            {tag}
                          </Badge>
                        ))}
                        {row.tags.length > 2 && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            +{row.tags.length - 2}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {/* Responsavel */}
                  <TableCell>
                    {row.assignee?.name ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {/* Data */}
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
