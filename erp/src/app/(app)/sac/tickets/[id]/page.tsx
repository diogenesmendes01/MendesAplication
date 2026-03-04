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
  AlertTriangle,
  Link,
  UserPlus,
  Search,
  Loader2,
  Upload,
  Coins,
  CheckCircle,
  XCircle,
  Banknote,
  Ban,
  FileDown,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/contexts/company-context";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getTicketById,
  updateTicketStatus,
  reassignTicket,
  listUsersForAssign,
  addTag,
  removeTag,
  getClientFinancialSummary,
  getTicketRefunds,
  getUserRole,
  requestRefund,
  approveRefund,
  rejectRefund,
  executeRefund,
  attachFileToTicket,
  searchClientsForLink,
  linkContactToClient,
  createClientAndLink,
  type TicketDetail,
  type ClientFinancialSummary,
  type ClientForLink,
  type RefundSummary,
  requestCancellation,
  approveCancellation,
  getCancellationInfo,
  type CancellationInfo,
  type CancellationType,
  listTimelineEvents,
  getAiConfigEnabled,
} from "../actions";
import type { TicketStatus } from "@prisma/client";
import { generateTicketPdf } from "@/lib/ticket-pdf";
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
  const [aiConfigEnabled, setAiConfigEnabled] = useState(false);

  // Contact linking state (US-081)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<ClientForLink[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [newClientForm, setNewClientForm] = useState({
    name: "",
    cpfCnpj: "",
    type: "PJ" as "PF" | "PJ",
    email: "",
    telefone: "",
    razaoSocial: "",
    endereco: "",
  });

  // Refund state (US-085)
  const [refunds, setRefunds] = useState<RefundSummary[]>([]);
  const [userRole, setUserRole] = useState<string>("");
  const [requestRefundOpen, setRequestRefundOpen] = useState(false);
  const [refundForm, setRefundForm] = useState({
    amount: "",
    justification: "",
    boletoId: "",
  });
  const [refundProofFile, setRefundProofFile] = useState<{ id: string; name: string } | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingRefund, setSubmittingRefund] = useState(false);

  // Reject dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectRefundId, setRejectRefundId] = useState<string>("");
  const [rejectReason, setRejectReason] = useState("");
  const [submittingReject, setSubmittingReject] = useState(false);

  // Execute dialog
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [executeRefundId, setExecuteRefundId] = useState<string>("");
  const [executeForm, setExecuteForm] = useState({
    paymentMethod: "PIX" as "PIX" | "TED",
    bankName: "",
    bankAgency: "",
    bankAccount: "",
    pixKey: "",
    invoiceAction: "NONE" as "CANCEL_INVOICE" | "CREDIT_NOTE" | "NONE",
    invoiceCancelReason: "",
  });
  const [executeProofFile, setExecuteProofFile] = useState<{ id: string; name: string } | null>(null);
  const [uploadingExecuteProof, setUploadingExecuteProof] = useState(false);
  const [submittingExecute, setSubmittingExecute] = useState(false);

  // Approve loading
  const [approvingRefundId, setApprovingRefundId] = useState<string | null>(null);

  // Cancellation state (US-086)
  const [cancellation, setCancellation] = useState<CancellationInfo | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelType, setCancelType] = useState<CancellationType>("both");
  const [cancelJustification, setCancelJustification] = useState("");
  const [submittingCancel, setSubmittingCancel] = useState(false);
  const [approvingCancel, setApprovingCancel] = useState(false);

  // Export PDF (US-089)
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportIncludeNotes, setExportIncludeNotes] = useState(true);
  const [exportIncludeAttachments, setExportIncludeAttachments] = useState(true);
  const [exporting, setExporting] = useState(false);

  // ---------------------------------------------------
  // Load ticket
  // ---------------------------------------------------

  const loadTicket = useCallback(async () => {
    if (!selectedCompanyId || !ticketId) return;
    setLoading(true);
    try {
      // Load ticket first (others depend on client.id)
      const data = await getTicketById(ticketId, selectedCompanyId);
      setTicket(data);
      setTags(data.tags);

      // Run all secondary queries in parallel
      await Promise.all([
        getClientFinancialSummary(data.client.id, selectedCompanyId)
          .then(setFinancial)
          .catch(() => {}),
        getTicketRefunds(ticketId, selectedCompanyId)
          .then(setRefunds)
          .catch(() => {}),
        getCancellationInfo(ticketId, selectedCompanyId)
          .then(setCancellation)
          .catch(() => {}),
        getAiConfigEnabled(selectedCompanyId)
          .then(setAiConfigEnabled)
          .catch(() => {}),
      ]);
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

  // Load users for reassignment and user role
  useEffect(() => {
    if (!selectedCompanyId) return;
    // Run both in parallel
    Promise.all([
      listUsersForAssign(selectedCompanyId).then(setUsers).catch(() => {}),
      getUserRole(selectedCompanyId).then(setUserRole).catch(() => {}),
    ]);
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
  // Contact linking (US-081)
  // ---------------------------------------------------

  const isUnknownClient = ticket?.client.cpfCnpj === "00000000000";

  async function handleLinkSearch(query: string) {
    setLinkSearch(query);
    if (!selectedCompanyId || query.trim().length < 2) {
      setLinkResults([]);
      return;
    }
    setLinkSearching(true);
    try {
      const results = await searchClientsForLink(selectedCompanyId, query);
      setLinkResults(results);
    } catch {
      setLinkResults([]);
    } finally {
      setLinkSearching(false);
    }
  }

  async function handleLinkToClient(clientId: string) {
    if (!selectedCompanyId || !ticket) return;
    setLinking(true);
    try {
      const result = await linkContactToClient(ticket.id, selectedCompanyId, clientId);
      toast.success(`Ticket vinculado ao cliente ${result.clientName}`);
      setLinkDialogOpen(false);
      setLinkSearch("");
      setLinkResults([]);
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao vincular cliente");
    } finally {
      setLinking(false);
    }
  }

  async function handleCreateAndLink() {
    if (!selectedCompanyId || !ticket) return;
    setLinking(true);
    try {
      const result = await createClientAndLink(ticket.id, selectedCompanyId, {
        name: newClientForm.name,
        cpfCnpj: newClientForm.cpfCnpj,
        type: newClientForm.type,
        email: newClientForm.email || undefined,
        telefone: newClientForm.telefone || undefined,
        razaoSocial: newClientForm.razaoSocial || undefined,
        endereco: newClientForm.endereco || undefined,
      });
      toast.success(`Cliente ${result.clientName} criado e vinculado`);
      setCreateDialogOpen(false);
      setNewClientForm({ name: "", cpfCnpj: "", type: "PJ", email: "", telefone: "", razaoSocial: "", endereco: "" });
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar cliente");
    } finally {
      setLinking(false);
    }
  }

  // ---------------------------------------------------
  // Refund handlers (US-085)
  // ---------------------------------------------------

  const isAdminOrManager = userRole === "ADMIN" || userRole === "MANAGER";

  async function handleUploadProof(
    e: React.ChangeEvent<HTMLInputElement>,
    target: "request" | "execute"
  ) {
    const file = e.target.files?.[0];
    if (!file || !selectedCompanyId) return;
    const setter = target === "request" ? setUploadingProof : setUploadingExecuteProof;
    setter(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("companyId", selectedCompanyId);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao fazer upload");
      }
      const data = await res.json();

      // Create Attachment record (requestRefund expects an existing Attachment id)
      const attachment = await attachFileToTicket(ticketId, selectedCompanyId, {
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        storagePath: data.storagePath,
      });

      if (target === "request") {
        setRefundProofFile({ id: attachment.id, name: data.fileName });
      } else {
        setExecuteProofFile({ id: attachment.id, name: data.fileName });
      }
      toast.success("Arquivo enviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao fazer upload");
    } finally {
      setter(false);
      e.target.value = "";
    }
  }

  async function handleSubmitRefund() {
    if (!selectedCompanyId || !ticket || !refundProofFile) return;
    setSubmittingRefund(true);
    try {
      await requestRefund(
        ticketId,
        selectedCompanyId,
        parseFloat(refundForm.amount),
        refundForm.justification,
        refundProofFile.id,
        ticket.boletoId || undefined
      );
      toast.success("Reembolso solicitado com sucesso");
      setRequestRefundOpen(false);
      setRefundForm({ amount: "", justification: "", boletoId: "" });
      setRefundProofFile(null);
      // Reload refunds
      getTicketRefunds(ticketId, selectedCompanyId).then(setRefunds).catch(() => {});
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao solicitar reembolso");
    } finally {
      setSubmittingRefund(false);
    }
  }

  async function handleApproveRefund(refundId: string) {
    if (!selectedCompanyId) return;
    setApprovingRefundId(refundId);
    try {
      await approveRefund(refundId, selectedCompanyId);
      toast.success("Reembolso aprovado");
      getTicketRefunds(ticketId, selectedCompanyId).then(setRefunds).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar reembolso");
    } finally {
      setApprovingRefundId(null);
    }
  }

  async function handleRejectRefund() {
    if (!selectedCompanyId || !rejectRefundId) return;
    setSubmittingReject(true);
    try {
      await rejectRefund(rejectRefundId, selectedCompanyId, rejectReason);
      toast.success("Reembolso rejeitado");
      setRejectDialogOpen(false);
      setRejectRefundId("");
      setRejectReason("");
      getTicketRefunds(ticketId, selectedCompanyId).then(setRefunds).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao rejeitar reembolso");
    } finally {
      setSubmittingReject(false);
    }
  }

  async function handleExecuteRefund() {
    if (!selectedCompanyId || !executeRefundId) return;
    setSubmittingExecute(true);
    try {
      await executeRefund(executeRefundId, selectedCompanyId, {
        paymentMethod: executeForm.paymentMethod,
        bankName: executeForm.bankName || undefined,
        bankAgency: executeForm.bankAgency || undefined,
        bankAccount: executeForm.bankAccount || undefined,
        pixKey: executeForm.pixKey || undefined,
        invoiceAction: executeForm.invoiceAction,
        invoiceCancelReason: executeForm.invoiceCancelReason || undefined,
        refundProofId: executeProofFile?.id,
      });
      toast.success("Reembolso executado com sucesso");
      setExecuteDialogOpen(false);
      setExecuteRefundId("");
      setExecuteForm({
        paymentMethod: "PIX",
        bankName: "",
        bankAgency: "",
        bankAccount: "",
        pixKey: "",
        invoiceAction: "NONE",
        invoiceCancelReason: "",
      });
      setExecuteProofFile(null);
      getTicketRefunds(ticketId, selectedCompanyId).then(setRefunds).catch(() => {});
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao executar reembolso");
    } finally {
      setSubmittingExecute(false);
    }
  }

  // ---------------------------------------------------
  // Cancellation handlers (US-086)
  // ---------------------------------------------------

  const hasProposalOrBoleto = !!(ticket?.proposalId || ticket?.boletoId);
  const hasPendingCancellation = cancellation?.pending ?? false;

  async function handleRequestCancellation() {
    if (!selectedCompanyId || !ticket) return;
    setSubmittingCancel(true);
    try {
      await requestCancellation(ticketId, selectedCompanyId, cancelType, cancelJustification);
      toast.success("Solicitação de cancelamento enviada");
      setCancelDialogOpen(false);
      setCancelType("both");
      setCancelJustification("");
      getCancellationInfo(ticketId, selectedCompanyId).then(setCancellation).catch(() => {});
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao solicitar cancelamento");
    } finally {
      setSubmittingCancel(false);
    }
  }

  async function handleApproveCancellation() {
    if (!selectedCompanyId || !ticket) return;
    setApprovingCancel(true);
    try {
      await approveCancellation(ticketId, selectedCompanyId);
      toast.success("Cancelamento aprovado e executado");
      getCancellationInfo(ticketId, selectedCompanyId).then(setCancellation).catch(() => {});
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar cancelamento");
    } finally {
      setApprovingCancel(false);
    }
  }

  // Export PDF (US-089)
  async function handleExportPdf() {
    if (!selectedCompanyId || !ticket) return;
    setExporting(true);
    try {
      const events = await listTimelineEvents(ticketId, selectedCompanyId);
      await generateTicketPdf({
        ticket,
        events,
        refunds,
        includeInternalNotes: exportIncludeNotes,
        includeAttachmentList: exportIncludeAttachments,
      });
      toast.success("PDF exportado com sucesso");
      setExportDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao exportar PDF");
    } finally {
      setExporting(false);
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

      {/* Unknown contact banner (US-081) */}
      {isUnknownClient && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              Contato não identificado
            </p>
            <p className="text-xs text-amber-700">
              {ticket.description.includes("Número:")
                ? `Número: ${ticket.description.match(/Número:\s*(\+?[\d]+)/)?.[1] ?? "desconhecido"}`
                : ticket.description.includes("Email recebido de")
                  ? `Email: ${ticket.description.match(/Email recebido de\s+([\w.+-]+@[\w.-]+)/)?.[1] ?? "desconhecido"}`
                  : "Remetente não identificado"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-800 hover:bg-amber-100"
              onClick={() => setLinkDialogOpen(true)}
            >
              <Link className="mr-1.5 h-3.5 w-3.5" />
              Vincular
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-800 hover:bg-amber-100"
              onClick={() => {
                // Pre-fill email/phone from ticket description
                const phoneMatch = ticket.description.match(/Número:\s*(\+?[\d]+)/);
                const emailMatch = ticket.description.match(/Email recebido de\s+([\w.+-]+@[\w.-]+)/);
                setNewClientForm((prev) => ({
                  ...prev,
                  email: emailMatch?.[1] ?? "",
                  telefone: phoneMatch?.[1] ?? "",
                }));
                setCreateDialogOpen(true);
              }}
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              Criar cliente
            </Button>
          </div>
        </div>
      )}

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
            aiEnabled={ticket.aiEnabled}
            aiConfigEnabled={aiConfigEnabled}
            channelType={ticket.channelType ?? null}
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

          {/* Refund Section (US-085) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Coins className="h-4 w-4" />
                Reembolso
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {refunds.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum reembolso solicitado</p>
              )}

              {refunds.map((refund) => (
                <div key={refund.id} className="rounded-lg border p-3 space-y-2">
                  {/* Status and amount */}
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={
                        refund.status === "COMPLETED" ? "default" :
                        refund.status === "REJECTED" ? "destructive" :
                        "secondary"
                      }
                      className={
                        refund.status === "COMPLETED" ? "bg-green-100 text-green-800 hover:bg-green-100" :
                        refund.status === "APPROVED" ? "bg-blue-100 text-blue-800 hover:bg-blue-100" :
                        refund.status === "AWAITING_APPROVAL" ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" :
                        ""
                      }
                    >
                      {refund.status === "AWAITING_APPROVAL" ? "Aguardando Aprovacao" :
                       refund.status === "APPROVED" ? "Aprovado" :
                       refund.status === "REJECTED" ? "Rejeitado" :
                       refund.status === "PROCESSING" ? "Processando" :
                       "Concluido"}
                    </Badge>
                    <span className="text-sm font-semibold">
                      R$ {refund.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Solicitante and date */}
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>Solicitante: {refund.requestedBy.name}</p>
                    <p>Data: {dateFmt.format(new Date(refund.requestedAt))}</p>
                    {refund.approvedBy && (
                      <p>
                        {refund.status === "REJECTED" ? "Rejeitado" : "Aprovado"} por: {refund.approvedBy.name}
                      </p>
                    )}
                    {refund.rejectionReason && (
                      <p className="text-red-600">Motivo: {refund.rejectionReason}</p>
                    )}
                    {refund.paymentMethod && (
                      <p>Metodo: {refund.paymentMethod}</p>
                    )}
                  </div>

                  {/* SLA indicator */}
                  {refund.slaDeadline && !["COMPLETED", "REJECTED"].includes(refund.status) && (
                    <div className="text-xs">
                      {(() => {
                        const dl = new Date(refund.slaDeadline);
                        const diffMs = dl.getTime() - Date.now();
                        const isBreached = refund.slaBreached || diffMs <= 0;
                        const atRisk = !isBreached && diffMs < 60 * 60_000;
                        return (
                          <span className={
                            isBreached ? "text-red-600 font-medium" :
                            atRisk ? "text-yellow-600 font-medium" :
                            "text-green-600"
                          }>
                            SLA: {isBreached ? "Estourado" : atRisk ? "Em Risco" : "OK"}
                            {" - "}
                            {isBreached
                              ? `-${Math.floor(Math.abs(diffMs) / 3_600_000)}h${String(Math.floor((Math.abs(diffMs) % 3_600_000) / 60_000)).padStart(2, "0")}m`
                              : `${Math.floor(diffMs / 3_600_000)}h${String(Math.floor((diffMs % 3_600_000) / 60_000)).padStart(2, "0")}m`
                            }
                          </span>
                        );
                      })()}
                    </div>
                  )}

                  {/* Action buttons */}
                  {refund.status === "AWAITING_APPROVAL" && isAdminOrManager && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-green-300 text-green-700 hover:bg-green-50"
                        disabled={approvingRefundId === refund.id}
                        onClick={() => handleApproveRefund(refund.id)}
                      >
                        {approvingRefundId === refund.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-1 h-3 w-3" />
                        )}
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                        onClick={() => {
                          setRejectRefundId(refund.id);
                          setRejectDialogOpen(true);
                        }}
                      >
                        <XCircle className="mr-1 h-3 w-3" />
                        Rejeitar
                      </Button>
                    </div>
                  )}

                  {refund.status === "APPROVED" && isAdminOrManager && (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setExecuteRefundId(refund.id);
                        setExecuteDialogOpen(true);
                      }}
                    >
                      <Banknote className="mr-1.5 h-3.5 w-3.5" />
                      Executar Reembolso
                    </Button>
                  )}
                </div>
              ))}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setRequestRefundOpen(true)}
              >
                <Coins className="mr-1.5 h-3.5 w-3.5" />
                Solicitar Reembolso
              </Button>
            </CardContent>
          </Card>

          {/* Cancellation Section (US-086) */}
          {hasProposalOrBoleto && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Ban className="h-4 w-4" />
                  Cancelamento
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {hasPendingCancellation && cancellation && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                        Aguardando Aprovação
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {cancellation.type && (
                        <p>
                          Tipo:{" "}
                          {cancellation.type === "proposal"
                            ? "Proposta"
                            : cancellation.type === "boletos"
                              ? "Boletos"
                              : "Proposta e Boletos"}
                        </p>
                      )}
                      {cancellation.requestedBy && (
                        <p>Solicitante: {cancellation.requestedBy}</p>
                      )}
                      {cancellation.requestedAt && (
                        <p>Data: {dateFmt.format(new Date(cancellation.requestedAt))}</p>
                      )}
                      {cancellation.justification && (
                        <p>Justificativa: {cancellation.justification}</p>
                      )}
                    </div>

                    {isAdminOrManager && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full border-green-300 text-green-700 hover:bg-green-50"
                        disabled={approvingCancel}
                        onClick={handleApproveCancellation}
                      >
                        {approvingCancel ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Aprovar Cancelamento
                      </Button>
                    )}
                  </div>
                )}

                {!hasPendingCancellation && (
                  <Button
                    variant="outline"
                    className="w-full border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => {
                      // Set default type based on what's available
                      if (ticket.proposalId && ticket.boletoId) {
                        setCancelType("both");
                      } else if (ticket.proposalId) {
                        setCancelType("proposal");
                      } else {
                        setCancelType("boletos");
                      }
                      setCancelDialogOpen(true);
                    }}
                  >
                    <Ban className="mr-1.5 h-3.5 w-3.5" />
                    Solicitar Cancelamento
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Export PDF (US-089) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileDown className="h-4 w-4" />
                Exportar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setExportDialogOpen(true)}
              >
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                Exportar PDF
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Export PDF dialog (US-089) */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Exportar Ticket como PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="export-notes"
                checked={exportIncludeNotes}
                onCheckedChange={(checked) => setExportIncludeNotes(checked === true)}
              />
              <Label htmlFor="export-notes" className="text-sm font-normal cursor-pointer">
                Incluir notas internas
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="export-attachments"
                checked={exportIncludeAttachments}
                onCheckedChange={(checked) => setExportIncludeAttachments(checked === true)}
              />
              <Label htmlFor="export-attachments" className="text-sm font-normal cursor-pointer">
                Incluir lista de anexos
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleExportPdf} disabled={exporting}>
              {exporting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
              )}
              {exporting ? "Exportando..." : "Exportar PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link to existing client dialog (US-081) */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular a Cliente Existente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou CNPJ/CPF..."
                value={linkSearch}
                onChange={(e) => handleLinkSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {linkSearching && (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Buscando...
              </div>
            )}
            {!linkSearching && linkSearch.length >= 2 && linkResults.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum cliente encontrado
              </p>
            )}
            {linkResults.length > 0 && (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {linkResults.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    disabled={linking}
                    onClick={() => handleLinkToClient(client.id)}
                    className="w-full rounded-md border p-3 text-left hover:bg-muted transition-colors"
                  >
                    <p className="text-sm font-medium">{client.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {client.cpfCnpj}
                      {client.email && ` · ${client.email}`}
                      {client.telefone && ` · ${client.telefone}`}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create new client dialog (US-081) */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Criar Novo Cliente e Vincular</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="new-client-name">Nome *</Label>
                <Input
                  id="new-client-name"
                  value={newClientForm.name}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do cliente"
                />
              </div>
              <div>
                <Label htmlFor="new-client-type">Tipo *</Label>
                <Select
                  value={newClientForm.type}
                  onValueChange={(v) => setNewClientForm((f) => ({ ...f, type: v as "PF" | "PJ" }))}
                >
                  <SelectTrigger id="new-client-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PJ">Pessoa Jurídica</SelectItem>
                    <SelectItem value="PF">Pessoa Física</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="new-client-cpfcnpj">
                  {newClientForm.type === "PF" ? "CPF" : "CNPJ"} *
                </Label>
                <Input
                  id="new-client-cpfcnpj"
                  value={newClientForm.cpfCnpj}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, cpfCnpj: e.target.value }))}
                  placeholder={newClientForm.type === "PF" ? "000.000.000-00" : "00.000.000/0000-00"}
                />
              </div>
              <div>
                <Label htmlFor="new-client-email">Email</Label>
                <Input
                  id="new-client-email"
                  type="email"
                  value={newClientForm.email}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="new-client-telefone">Telefone</Label>
                <Input
                  id="new-client-telefone"
                  value={newClientForm.telefone}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, telefone: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="new-client-razao">Razão Social</Label>
                <Input
                  id="new-client-razao"
                  value={newClientForm.razaoSocial}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, razaoSocial: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="new-client-endereco">Endereço</Label>
                <Input
                  id="new-client-endereco"
                  value={newClientForm.endereco}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, endereco: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateAndLink}
              disabled={linking || !newClientForm.name.trim() || !newClientForm.cpfCnpj.trim()}
            >
              {linking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar e Vincular"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Refund Dialog (US-085) */}
      <Dialog open={requestRefundOpen} onOpenChange={setRequestRefundOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Solicitar Reembolso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="refund-amount">Valor (R$) *</Label>
              <Input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={refundForm.amount}
                onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0,00"
              />
            </div>

            {ticket?.boletoId && (
              <div>
                <Label htmlFor="refund-boleto">Boleto Vinculado</Label>
                <Input
                  id="refund-boleto"
                  value={ticket.boletoId}
                  disabled
                  className="text-xs"
                />
                <input
                  type="hidden"
                  value={ticket.boletoId}
                  onChange={() => setRefundForm((f) => ({ ...f, boletoId: ticket.boletoId ?? "" }))}
                />
              </div>
            )}

            <div>
              <Label>Comprovante de Pagamento *</Label>
              {refundProofFile ? (
                <div className="flex items-center gap-2 mt-1 rounded border p-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{refundProofFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setRefundProofFile(null)}
                    className="rounded p-0.5 hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="mt-1">
                  <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                    {uploadingProof ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {uploadingProof ? "Enviando..." : "Clique para enviar comprovante"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.gif"
                      disabled={uploadingProof}
                      onChange={(e) => handleUploadProof(e, "request")}
                    />
                  </label>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="refund-justification">Justificativa *</Label>
              <Textarea
                id="refund-justification"
                value={refundForm.justification}
                onChange={(e) => setRefundForm((f) => ({ ...f, justification: e.target.value }))}
                placeholder="Descreva o motivo do reembolso..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestRefundOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmitRefund}
              disabled={
                submittingRefund ||
                !refundForm.amount ||
                parseFloat(refundForm.amount) <= 0 ||
                !refundForm.justification.trim() ||
                !refundProofFile
              }
            >
              {submittingRefund ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Solicitando...
                </>
              ) : (
                "Solicitar Reembolso"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Refund Dialog (US-085) */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rejeitar Reembolso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reject-reason">Motivo da Rejeicao *</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Descreva o motivo da rejeição..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectRefund}
              disabled={submittingReject || !rejectReason.trim()}
            >
              {submittingReject ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejeitando...
                </>
              ) : (
                "Confirmar Rejeicao"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Execute Refund Dialog (US-085) */}
      <Dialog open={executeDialogOpen} onOpenChange={setExecuteDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Executar Reembolso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Metodo de Pagamento *</Label>
              <Select
                value={executeForm.paymentMethod}
                onValueChange={(v) =>
                  setExecuteForm((f) => ({ ...f, paymentMethod: v as "PIX" | "TED" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PIX">PIX</SelectItem>
                  <SelectItem value="TED">TED</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {executeForm.paymentMethod === "PIX" && (
              <div>
                <Label htmlFor="exec-pix-key">Chave PIX *</Label>
                <Input
                  id="exec-pix-key"
                  value={executeForm.pixKey}
                  onChange={(e) => setExecuteForm((f) => ({ ...f, pixKey: e.target.value }))}
                  placeholder="CPF, CNPJ, email, telefone ou chave aleatória"
                />
              </div>
            )}

            {executeForm.paymentMethod === "TED" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3">
                  <Label htmlFor="exec-bank-name">Banco *</Label>
                  <Input
                    id="exec-bank-name"
                    value={executeForm.bankName}
                    onChange={(e) => setExecuteForm((f) => ({ ...f, bankName: e.target.value }))}
                    placeholder="Nome do banco"
                  />
                </div>
                <div>
                  <Label htmlFor="exec-bank-agency">Agencia *</Label>
                  <Input
                    id="exec-bank-agency"
                    value={executeForm.bankAgency}
                    onChange={(e) => setExecuteForm((f) => ({ ...f, bankAgency: e.target.value }))}
                    placeholder="0000"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="exec-bank-account">Conta *</Label>
                  <Input
                    id="exec-bank-account"
                    value={executeForm.bankAccount}
                    onChange={(e) => setExecuteForm((f) => ({ ...f, bankAccount: e.target.value }))}
                    placeholder="00000-0"
                  />
                </div>
              </div>
            )}

            <div>
              <Label>Acao NFS-e</Label>
              <Select
                value={executeForm.invoiceAction}
                onValueChange={(v) =>
                  setExecuteForm((f) => ({
                    ...f,
                    invoiceAction: v as "CANCEL_INVOICE" | "CREDIT_NOTE" | "NONE",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nenhuma</SelectItem>
                  <SelectItem value="CANCEL_INVOICE">Cancelar NFS-e</SelectItem>
                  <SelectItem value="CREDIT_NOTE">Emitir Nota de Credito</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {executeForm.invoiceAction === "CANCEL_INVOICE" && (
              <div>
                <Label htmlFor="exec-cancel-reason">Motivo do Cancelamento *</Label>
                <Textarea
                  id="exec-cancel-reason"
                  value={executeForm.invoiceCancelReason}
                  onChange={(e) => setExecuteForm((f) => ({ ...f, invoiceCancelReason: e.target.value }))}
                  placeholder="Motivo do cancelamento da NFS-e..."
                  rows={2}
                />
              </div>
            )}

            <div>
              <Label>Comprovante de Reembolso</Label>
              {executeProofFile ? (
                <div className="flex items-center gap-2 mt-1 rounded border p-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{executeProofFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setExecuteProofFile(null)}
                    className="rounded p-0.5 hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="mt-1">
                  <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                    {uploadingExecuteProof ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {uploadingExecuteProof ? "Enviando..." : "Clique para enviar comprovante"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.gif"
                      disabled={uploadingExecuteProof}
                      onChange={(e) => handleUploadProof(e, "execute")}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecuteDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleExecuteRefund}
              disabled={
                submittingExecute ||
                (executeForm.paymentMethod === "PIX" && !executeForm.pixKey.trim()) ||
                (executeForm.paymentMethod === "TED" && (!executeForm.bankName.trim() || !executeForm.bankAgency.trim() || !executeForm.bankAccount.trim())) ||
                (executeForm.invoiceAction === "CANCEL_INVOICE" && !executeForm.invoiceCancelReason.trim())
              }
            >
              {submittingExecute ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Executando...
                </>
              ) : (
                "Executar Reembolso"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Cancellation Dialog (US-086) */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Solicitar Cancelamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>O que deseja cancelar? *</Label>
              <Select
                value={cancelType}
                onValueChange={(v) => setCancelType(v as CancellationType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ticket?.proposalId && ticket?.boletoId && (
                    <SelectItem value="both">Proposta e Boletos</SelectItem>
                  )}
                  {ticket?.proposalId && (
                    <SelectItem value="proposal">Apenas Proposta</SelectItem>
                  )}
                  {ticket?.boletoId && (
                    <SelectItem value="boletos">Apenas Boletos</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="cancel-justification">Justificativa *</Label>
              <Textarea
                id="cancel-justification"
                value={cancelJustification}
                onChange={(e) => setCancelJustification(e.target.value)}
                placeholder="Descreva o motivo do cancelamento..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRequestCancellation}
              disabled={submittingCancel || !cancelJustification.trim()}
            >
              {submittingCancel ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Solicitando...
                </>
              ) : (
                "Solicitar Cancelamento"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
