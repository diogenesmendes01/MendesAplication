"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  User,
  Calendar,
  Tag,
  Building2,
  FileText,
  CreditCard,
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
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/company-context";
import {
  getTicketById,
  updateTicketStatus,
  reassignTicket,
  listUsersForAssign,
  type TicketDetail,
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

  // ---------------------------------------------------
  // Load ticket
  // ---------------------------------------------------

  const loadTicket = useCallback(async () => {
    if (!selectedCompanyId || !ticketId) return;
    setLoading(true);
    try {
      const data = await getTicketById(ticketId, selectedCompanyId);
      setTicket(data);
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
                  {ticket.client.email && (
                    <p className="text-xs text-muted-foreground">
                      {ticket.client.email}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Empresa
                  </p>
                  <p className="text-sm">{ticket.company.nomeFantasia}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Tag className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Prioridade
                  </p>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${priorityColor(ticket.priority)}`}
                  >
                    {priorityLabel(ticket.priority)}
                  </span>
                </div>
              </div>

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
        </div>
      </div>
    </div>
  );
}
