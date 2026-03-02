"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  User,
  Calendar,
  Building2,
  FileText,
  CreditCard,
  Mail,
  MessageSquare,
  Globe,
  X,
  Plus,
  UserCircle,
  Clock,
  DollarSign,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/contexts/company-context";
import {
  getTicketById,
  updateTicketStatus,
  reassignTicket,
  listUsersForAssign,
  addTag,
  removeTag,
  getClientFinancialSummary,
  type TicketDetail,
  type ClientFinancialSummary,
} from "../actions";
import type { TicketStatus } from "@prisma/client";
import TicketTimeline from "./ticket-timeline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
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

function SlaCard({ label, deadline, breached }: { label: string; deadline: string; breached: boolean }) {
  const deadlineDate = new Date(deadline);
  const now = Date.now();
  const diffMs = deadlineDate.getTime() - now;

  const isBreached = breached || diffMs <= 0;
  const progressPct = isBreached ? 100 : Math.min(100, Math.max(0, 100 - (diffMs / (60 * 60_000)) * 10));

  let barColor = "bg-green-500";
  if (progressPct >= 90 || isBreached) barColor = "bg-red-500";
  else if (progressPct >= 70) barColor = "bg-yellow-500";

  let statusLabel = "OK";
  let statusColor = "text-green-600";
  if (isBreached) {
    statusLabel = "Estourado";
    statusColor = "text-red-600";
  } else if (progressPct >= 70) {
    statusLabel = "Em Risco";
    statusColor = "text-yellow-600";
  }

  // Time remaining
  let timeText: string;
  if (diffMs <= 0) {
    const overMs = Math.abs(diffMs);
    const h = Math.floor(overMs / 3_600_000);
    const m = Math.floor((overMs % 3_600_000) / 60_000);
    timeText = `-${h}h${String(m).padStart(2, "0")}m`;
  } else {
    const h = Math.floor(diffMs / 3_600_000);
    const m = Math.floor((diffMs % 3_600_000) / 60_000);
    timeText = `${h}h${String(m).padStart(2, "0")}m`;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <span className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(100, progressPct)}%` }}
          />
        </div>
        <span className="text-xs font-mono text-muted-foreground w-16 text-right">
          {timeText}
        </span>
      </div>
    </div>
  );
}

const STATUS_TRANSITIONS: Record<string, { value: TicketStatus; label: string }[]> = {
  OPEN: [{ value: "IN_PROGRESS", label: "Iniciar Atendimento" }],
  IN_PROGRESS: [
    { value: "WAITING_CLIENT", label: "Aguardar Cliente" },
    { value: "RESOLVED", label: "Resolver" },
  ],
  WAITING_CLIENT: [
    { value: "IN_PROGRESS", label: "Retomar Atendimento" },
    { value: "RESOLVED", label: "Resolver" },
  ],
  RESOLVED: [
    { value: "CLOSED", label: "Fechar" },
    { value: "IN_PROGRESS", label: "Reabrir" },
  ],
  CLOSED: [],
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ticketId = params.id as string;
  const { selectedCompanyId } = useCompany();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingAssignee, setUpdatingAssignee] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [financial, setFinancial] = useState<ClientFinancialSummary | null>(null);

  // ---------------------------------------------------
  // Load ticket
  // ---------------------------------------------------

  const loadTicket = useCallback(async () => {
    if (!selectedCompanyId || !ticketId) return;
    setLoading(true);
    try {
      const data = await getTicketById(ticketId, selectedCompanyId);
      setTicket(data);
      setTags(data.tags);
      getClientFinancialSummary(data.client.id, selectedCompanyId)
        .then(setFinancial)
        .catch(() => {});
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar ticket"
      );
    } finally {
      setLoading(false);
    }
  }, [ticketId, selectedCompanyId]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  // Load users for reassignment
  useEffect(() => {
    if (!selectedCompanyId) return;
    listUsersForAssign(selectedCompanyId).then(setUsers).catch(() => {});
  }, [selectedCompanyId]);

  // ---------------------------------------------------
  // Status change
  // ---------------------------------------------------

  async function handleStatusChange(newStatus: TicketStatus) {
    if (!selectedCompanyId || !ticket) return;
    setUpdatingStatus(true);
    try {
      const result = await updateTicketStatus(
        ticket.id,
        selectedCompanyId,
        newStatus
      );
      setTicket((prev) =>
        prev ? { ...prev, status: result.status } : prev
      );
      toast.success(`Status atualizado para: ${statusLabel(result.status)}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao atualizar status"
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  // ---------------------------------------------------
  // Reassign
  // ---------------------------------------------------

  async function handleReassign(assigneeId: string) {
    if (!selectedCompanyId || !ticket) return;
    setUpdatingAssignee(true);
    try {
      const result = await reassignTicket(
        ticket.id,
        selectedCompanyId,
        assigneeId === "__none__" ? null : assigneeId
      );
      setTicket((prev) =>
        prev ? { ...prev, assignee: result.assignee } : prev
      );
      toast.success(
        result.assignee
          ? `Ticket reatribuído para ${result.assignee.name}`
          : "Responsável removido"
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao reatribuir ticket"
      );
    } finally {
      setUpdatingAssignee(false);
    }
  }

  // ---------------------------------------------------
  // Tags
  // ---------------------------------------------------

  async function handleAddTag() {
    if (!selectedCompanyId || !ticket || !newTag.trim()) return;
    try {
      const updatedTags = await addTag(ticket.id, selectedCompanyId, newTag.trim());
      setTags(updatedTags);
      setNewTag("");
      toast.success("Tag adicionada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar tag");
    }
  }

  async function handleRemoveTag(tag: string) {
    if (!selectedCompanyId || !ticket) return;
    try {
      const updatedTags = await removeTag(ticket.id, selectedCompanyId, tag);
      setTags(updatedTags);
      toast.success("Tag removida");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover tag");
    }
  }

  // ---------------------------------------------------
  // No company selected
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar o ticket.
      </div>
    );
  }

  // ---------------------------------------------------
  // Loading
  // ---------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push("/sac/tickets")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Ticket não encontrado.
        </div>
      </div>
    );
  }

  const transitions = STATUS_TRANSITIONS[ticket.status] ?? [];

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/sac/tickets")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {ticket.subject}
            </h1>
            <p className="text-sm text-muted-foreground">
              Ticket #{ticket.id.slice(-8)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${priorityColor(ticket.priority)}`}
          >
            {priorityLabel(ticket.priority)}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${statusColor(ticket.status)}`}
          >
            {statusLabel(ticket.status)}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Descricao</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {ticket.description}
              </p>
            </CardContent>
          </Card>

          {/* Status transitions */}
          {transitions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Alterar Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {transitions.map((t) => (
                    <Button
                      key={t.value}
                      variant="outline"
                      disabled={updatingStatus}
                      onClick={() => handleStatusChange(t.value)}
                    >
                      {updatingStatus ? "Atualizando..." : t.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <TicketTimeline
            ticketId={ticketId}
            companyId={selectedCompanyId}
            ticketSubject={ticket.subject}
          />
        </div>

        {/* Sidebar info */}
        <div className="space-y-6">
          {/* Ticket info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Informacoes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Cliente
                  </p>
                  <p className="text-sm font-medium">{ticket.client.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ticket.client.cpfCnpj}
                  </p>
                </div>
              </div>

              {ticket.contact && (
                <div className="flex items-start gap-3">
                  <UserCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Contato
                    </p>
                    <p className="text-sm font-medium">{ticket.contact.name}</p>
                    {ticket.contact.role && (
                      <p className="text-xs text-muted-foreground">
                        {ticket.contact.role}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Empresa
                  </p>
                  <p className="text-sm">{ticket.company.nomeFantasia}</p>
                </div>
              </div>

              {ticket.channelType && (
                <div className="flex items-start gap-3">
                  {ticket.channelType === "EMAIL" ? (
                    <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  ) : ticket.channelType === "WHATSAPP" ? (
                    <MessageSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Globe className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Canal de Origem
                    </p>
                    <p className="text-sm">
                      {ticket.channelType === "EMAIL" ? "Email" : "WhatsApp"}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Criado em
                  </p>
                  <p className="text-sm">
                    {dateFmt.format(new Date(ticket.createdAt))}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Atualizado em
                  </p>
                  <p className="text-sm">
                    {dateFmt.format(new Date(ticket.updatedAt))}
                  </p>
                </div>
              </div>

              {/* Linked Proposal */}
              {ticket.proposalId && (
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Proposta Vinculada
                    </p>
                    <p className="text-sm text-primary">
                      #{ticket.proposalId.slice(-8)}
                    </p>
                  </div>
                </div>
              )}

              {/* Linked Boleto */}
              {ticket.boletoId && (
                <div className="flex items-start gap-3">
                  <CreditCard className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Boleto Vinculado
                    </p>
                    <p className="text-sm text-primary">
                      #{ticket.boletoId.slice(-8)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reassign */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Responsavel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="assignee">Atribuir a</Label>
                <Select
                  value={ticket.assignee?.id ?? "__none__"}
                  onValueChange={handleReassign}
                  disabled={updatingAssignee}
                >
                  <SelectTrigger id="assignee">
                    <SelectValue placeholder="Selecione um responsavel" />
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
            </CardContent>
          </Card>

          {/* Tags */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Tags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {tags.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma tag</p>
                )}
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="gap-1 pr-1"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Nova tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddTag}
                  disabled={!newTag.trim()}
                  className="h-8 px-2"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* SLA */}
          {(ticket.slaFirstReply || ticket.slaResolution) && !["RESOLVED", "CLOSED"].includes(ticket.status) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  SLA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {ticket.slaFirstReply && (
                  <SlaCard
                    label="1a Resposta"
                    deadline={ticket.slaFirstReply}
                    breached={ticket.slaBreached}
                  />
                )}
                {ticket.slaResolution && (
                  <SlaCard
                    label="Resolucao"
                    deadline={ticket.slaResolution}
                    breached={ticket.slaBreached}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Financial */}
          {financial && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Situacao Financeira
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Badge
                    variant={financial.status === "adimplente" ? "default" : "destructive"}
                    className={
                      financial.status === "adimplente"
                        ? "bg-green-100 text-green-800 hover:bg-green-100"
                        : financial.status === "atraso"
                          ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
                          : ""
                    }
                  >
                    {financial.status === "adimplente"
                      ? "Adimplente"
                      : financial.status === "atraso"
                        ? "Em Atraso"
                        : "Inadimplente"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Pendente</p>
                    <p className="font-medium">
                      R$ {financial.pendingTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Vencido</p>
                    <p className="font-medium text-red-600">
                      R$ {financial.overdueTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {financial.lastPayment && (
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">Ultimo Pagamento</p>
                    <p>{dateFmt.format(new Date(financial.lastPayment))}</p>
                  </div>
                )}

                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => router.push("/financeiro/receber")}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Ver financeiro
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
