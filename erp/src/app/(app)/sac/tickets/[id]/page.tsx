"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
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
  Link as LinkIcon,
  UserPlus,
  Search,
  Loader2,
  Coins,
  CheckCircle,
  XCircle,
  Banknote,
  Ban,
  FileDown,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  ArrowUpRight,
  ChevronRight,
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
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useCompany } from "@/contexts/company-context";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getTicketDetailBootstrap,
  updateTicketStatus,
  reassignTicket,
  addTag,
  removeTag,
  getTicketRefunds,
  approveRefund,
  rejectRefund,
  searchClientsForLink,
  linkContactToClient,
  createClientAndLink,
  type TicketDetail,
  type ClientFinancialSummary,
  type ClientForLink,
  type RefundSummary,
  approveCancellation,
  getCancellationInfo,
  type CancellationInfo,
  listTimelineEvents,
} from "../actions";
import type { TicketStatus } from "@prisma/client";
import { generateTicketPdf } from "@/lib/ticket-pdf";
import TicketTimeline from "./ticket-timeline";
import RaModerationDialog from "./ra-moderation-dialog";
import { ChannelBreadcrumb } from "@/components/sac/channel-breadcrumb";
import { ChannelBadge } from "@/components/sac/channel-badge";
import {
  getRaTicketContext,
  requestRaEvaluation,
  finishPrivateMessage,
  sendPrivateMessageWithAttachments,
  sendRaResponse,
} from "../ra-actions";
import { RaFileUpload } from "../../components/ra-file-upload";
import LinkedTicketsBanner from "./linked-tickets-banner";
import MergedTicketBanner from "./merged-ticket-banner";
import RaActionBar from "./ra-action-bar";
import RaResponsePanel from "./ra-response-panel";
import RaSuggestionCard from "./ra-suggestion-card";

const RequestRefundDialog = dynamic(() =>
  import("./refund-dialogs").then((m) => ({ default: m.RequestRefundDialog })),
  { ssr: false }
);
const ExecuteRefundDialog = dynamic(() =>
  import("./refund-dialogs").then((m) => ({ default: m.ExecuteRefundDialog })),
  { ssr: false }
);
const CancellationDialog = dynamic(() =>
  import("./cancellation-dialog").then((m) => ({ default: m.CancellationDialog })),
  { ssr: false }
);

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
    case "HIGH": return "Alta";
    case "LOW": return "Baixa";
    default: return "Média";
  }
}

function priorityColor(p: string) {
  switch (p) {
    case "HIGH": return "bg-red-100 text-red-800";
    case "LOW": return "bg-blue-100 text-blue-800";
    default: return "bg-yellow-100 text-yellow-800";
  }
}

function statusLabel(s: string) {
  switch (s) {
    case "OPEN": return "Aberto";
    case "IN_PROGRESS": return "Em Andamento";
    case "WAITING_CLIENT": return "Aguardando Cliente";
    case "RESOLVED": return "Resolvido";
    case "CLOSED": return "Fechado";
    case "MERGED": return "Mergeado";
    default: return s;
  }
}

function statusColor(s: string) {
  switch (s) {
    case "OPEN": return "bg-blue-100 text-blue-800";
    case "IN_PROGRESS": return "bg-yellow-100 text-yellow-800";
    case "WAITING_CLIENT": return "bg-orange-100 text-orange-800";
    case "RESOLVED": return "bg-green-100 text-green-800";
    case "CLOSED": return "bg-gray-100 text-gray-800";
    case "MERGED": return "bg-purple-100 text-purple-800";
    default: return "bg-gray-100 text-gray-800";
  }
}

function getFeelingEmoji(feeling: string | null): string {
  if (!feeling) return "";
  const f = feeling.toLowerCase();
  if (f.includes("irritado") || f.includes("raiva")) return "😡";
  if (f.includes("triste") || f.includes("decepcionado")) return "😢";
  if (f.includes("neutro")) return "😐";
  if (f.includes("satisfeito")) return "😊";
  return "💬";
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

  let sl = "OK";
  let sc = "text-green-600";
  if (isBreached) { sl = "Estourado"; sc = "text-red-600"; }
  else if (progressPct >= 70) { sl = "Em Risco"; sc = "text-yellow-600"; }

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
        <span className={`text-xs font-semibold ${sc}`}>{sl}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, progressPct)}%` }} />
        </div>
        <span className="text-xs font-mono text-muted-foreground w-16 text-right">{timeText}</span>
      </div>
    </div>
  );
}

function RaSlaInline({ deadline }: { deadline: string }) {
  const dl = new Date(deadline);
  const now = new Date();
  const target = new Date(dl); target.setHours(0, 0, 0, 0);
  const cursor = new Date(now); cursor.setHours(0, 0, 0, 0);
  let days = 0;
  if (cursor >= target) {
    const d = new Date(target);
    while (d < cursor) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days--; }
  } else {
    const d = new Date(cursor);
    while (d < target) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days++; }
  }
  let cls = "bg-emerald-100 text-emerald-800";
  let txt = `${days}d úteis`;
  if (days <= 0) { cls = "bg-black text-white"; txt = days === 0 ? "Vence hoje" : `${Math.abs(days)}d expirado`; }
  else if (days <= 2) { cls = "bg-red-100 text-red-800"; txt = `⚠️ ${days}d`; }
  else if (days <= 5) { cls = "bg-yellow-100 text-yellow-800"; txt = `${days}d úteis`; }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}><Clock className="h-3 w-3" />{txt}</span>;
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [raContext, setRaContext] = useState<any>(null);
  const [loadingRaContext, setLoadingRaContext] = useState(false);

  // AI suggestion pre-populate state (US-RA-R03)
  const [initialPublicMessage, setInitialPublicMessage] = useState<string>("");

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

  // Reject dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectRefundId, setRejectRefundId] = useState<string>("");
  const [rejectReason, setRejectReason] = useState("");
  const [submittingReject, setSubmittingReject] = useState(false);

  // Execute dialog
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [executeRefundId, setExecuteRefundId] = useState<string>("");

  // Approve loading
  const [approvingRefundId, setApprovingRefundId] = useState<string | null>(null);

  // Cancellation state (US-086)
  const [cancellation, setCancellation] = useState<CancellationInfo | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [approvingCancel, setApprovingCancel] = useState(false);

  // Export PDF (US-089)
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportIncludeNotes, setExportIncludeNotes] = useState(true);
  const [exportIncludeAttachments, setExportIncludeAttachments] = useState(true);
  const [exporting, setExporting] = useState(false);

  // RA actions state
  const [raModerationOpen, setRaModerationOpen] = useState(false);
  const [requestingEval, setRequestingEval] = useState(false);
  const [finishingPrivate, setFinishingPrivate] = useState(false);

  // RA response states (US-RA-R02)
  const [sendingRaPublic, setSendingRaPublic] = useState(false);
  const [sendingRaPrivate, setSendingRaPrivate] = useState(false);

  // Legacy RA private message (kept for generic path fallback)
  const [raPrivateMessage, setRaPrivateMessage] = useState("");
  const [raPrivateFiles, setRaPrivateFiles] = useState<File[]>([]);

  // ---------------------------------------------------
  // Load ticket
  // ---------------------------------------------------

  const loadTicket = useCallback(async () => {
    if (!selectedCompanyId || !ticketId) return;
    setLoading(true);
    try {
      const result = await getTicketDetailBootstrap(ticketId, selectedCompanyId);
      if (!result) { setTicket(null); return; }
      setTicket(result.ticket);
      setTags(result.ticket.tags);
      setFinancial(result.financialSummary);
      setRefunds(result.refunds);
      setCancellation(result.cancellation);
      setAiConfigEnabled(result.aiEnabled);
      setUsers(result.users);
      setUserRole(result.userRole);

      if (result.ticket.channelType === "RECLAMEAQUI") {
        setLoadingRaContext(true);
        try {
          const raCtx = await getRaTicketContext(ticketId, selectedCompanyId);
          setRaContext(raCtx);
        } catch (_err) {
          toast.error("Erro ao carregar contexto do Reclame Aqui");
        } finally {
          setLoadingRaContext(false);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId, selectedCompanyId]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  // ---------------------------------------------------
  // Status change
  // ---------------------------------------------------

  async function handleStatusChange(newStatus: TicketStatus) {
    if (!selectedCompanyId || !ticket) return;
    setUpdatingStatus(true);
    try {
      const result = await updateTicketStatus(ticket.id, selectedCompanyId, newStatus);
      setTicket((prev) => prev ? { ...prev, status: result.status } : prev);
      toast.success(`Status atualizado para: ${statusLabel(result.status)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar status");
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
      const result = await reassignTicket(ticket.id, selectedCompanyId, assigneeId === "__none__" ? null : assigneeId);
      setTicket((prev) => prev ? { ...prev, assignee: result.assignee } : prev);
      toast.success(result.assignee ? `Ticket reatribuído para ${result.assignee.name}` : "Responsável removido");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reatribuir ticket");
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
    if (!selectedCompanyId || query.trim().length < 2) { setLinkResults([]); return; }
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

  // ---------------------------------------------------
  // Cancellation handlers (US-086)
  // ---------------------------------------------------

  const hasProposalOrBoleto = !!(ticket?.proposalId || ticket?.boletoId);
  const hasPendingCancellation = cancellation?.pending ?? false;

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
      await generateTicketPdf({ ticket, events, refunds, includeInternalNotes: exportIncludeNotes, includeAttachmentList: exportIncludeAttachments });
      toast.success("PDF exportado com sucesso");
      setExportDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao exportar PDF");
    } finally {
      setExporting(false);
    }
  }

  // ---------------------------------------------------
  // RA evaluation handler
  // ---------------------------------------------------

  async function handleRequestRaEvaluation() {
    if (!selectedCompanyId || !ticket) return;
    setRequestingEval(true);
    try {
      const result = await requestRaEvaluation(ticketId, selectedCompanyId);
      if (!result.success) { toast.error(result.error ?? "Erro ao solicitar avaliação"); return; }
      toast.success("Solicitação de avaliação enviada ao Reclame Aqui");
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setRequestingEval(false);
    }
  }

  // ---------------------------------------------------
  // RA finish private message handler
  // ---------------------------------------------------

  async function handleFinishPrivate() {
    if (!selectedCompanyId || !ticket) return;
    setFinishingPrivate(true);
    try {
      const result = await finishPrivateMessage(ticketId, selectedCompanyId);
      if (!result.success) {
        const errorMsg = result.error?.includes("40925")
          ? "Mensagem privada já encerrada ou não iniciada"
          : (result.error ?? "Erro ao encerrar mensagem privada");
        toast.error(errorMsg);
        return;
      }
      toast.success("Mensagem privada encerrada");
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setFinishingPrivate(false);
    }
  }

  // ---------------------------------------------------
  // RA send public message (US-RA-R02)
  // ---------------------------------------------------

  async function handleSendRaPublicMessage(message: string) {
    if (!selectedCompanyId || !ticket || !message.trim()) return;
    setSendingRaPublic(true);
    try {
      const result = await sendRaResponse(ticketId, selectedCompanyId, message.trim());
      if (!result.success) {
        toast.error(result.error ?? "Erro ao enviar resposta pública");
        return;
      }
      toast.success("Resposta pública enviada ao Reclame Aqui");
      setInitialPublicMessage("");
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSendingRaPublic(false);
    }
  }

  // ---------------------------------------------------
  // RA send private message (US-RA-R02)
  // ---------------------------------------------------

  async function handleSendRaPrivateMessage(message?: string, files?: File[]) {
    // Support both old (no args) and new (message/files via panel) call signatures
    const msg = message ?? raPrivateMessage;
    const fls = files ?? raPrivateFiles;
    if (!selectedCompanyId || !ticket || !msg.trim()) return;
    setSendingRaPrivate(true);
    try {
      let formData: FormData | undefined;
      if (fls.length > 0) {
        formData = new FormData();
        for (const file of fls) formData.append("files", file);
      }
      const result = await sendPrivateMessageWithAttachments(ticketId, selectedCompanyId, msg.trim(), formData);
      if (!result.success) { toast.error(result.error ?? "Erro ao enviar mensagem privada"); return; }
      toast.success("Mensagem privada enviada com sucesso");
      setRaPrivateMessage("");
      setRaPrivateFiles([]);
      loadTicket();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSendingRaPrivate(false);
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
  const isRa = ticket.channelType === "RECLAMEAQUI";

  // ─── RA Suggestion (from raContext.lastSuggestion) ──────────────
  const raSuggestion = raContext?.lastSuggestion ?? null;

  // Helper: parse suggestion content to extract publicMessage
  function extractPublicFromSuggestion(content: string): string {
    try {
      const parsed = JSON.parse(content);
      return parsed.publicMessage ?? parsed.suggestedResponse ?? content;
    } catch {
      return content;
    }
  }

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <ChannelBreadcrumb channelType={ticket.channelType ?? null} ticketId={ticket.id} />

      {/* ─── RA Identity Header (US-RA-R01) ──────────────────────── */}
      {isRa ? (
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-5 py-4 space-y-3">
          {/* Top row: back + title + badges */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/sac/tickets")}
                className="mt-0.5 shrink-0"
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Voltar
              </Button>
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-600 px-2.5 py-0.5 text-xs font-bold text-white">
                    <Globe className="h-3 w-3" />
                    Reclame Aqui
                  </span>
                  {ticket.aiEnabled && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                      <Sparkles className="h-3 w-3" />
                      IA ativa
                    </span>
                  )}
                  {ticket.raStatusName && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white border border-purple-200 px-2 py-0.5 text-xs font-semibold text-purple-800">
                      {ticket.raStatusName}
                    </span>
                  )}
                  {ticket.raSlaDeadline && !["RESOLVED", "CLOSED"].includes(ticket.status) && (
                    <RaSlaInline deadline={ticket.raSlaDeadline} />
                  )}
                </div>
                <h1 className="text-xl font-bold tracking-tight text-purple-900">
                  {ticket.subject}
                </h1>
                <p className="text-xs text-purple-600 mt-0.5">
                  Ticket #{ticket.id.slice(-8)}
                </p>
              </div>
            </div>

            {/* Right side: feeling + priority + status + RA link */}
            <div className="flex items-center gap-2 flex-wrap sm:justify-end">
              {/* Consumer feeling */}
              {raContext?.raFeeling && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white border border-purple-200 px-2.5 py-1 text-xs font-medium text-purple-800">
                  {getFeelingEmoji(raContext?.raFeeling)} {raContext?.raFeeling}
                </span>
              )}
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${priorityColor(ticket.priority)}`}>
                {priorityLabel(ticket.priority)}
              </span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${statusColor(ticket.status)}`}>
                {statusLabel(ticket.status)}
              </span>
              {ticket.raExternalId && (
                <a
                  href={`https://www.reclameaqui.com.br/empresa/ocorrencia/ver/${ticket.raExternalId}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-purple-300 bg-white px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                >
                  <ArrowUpRight className="h-3 w-3" />
                  Ver no RA
                </a>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Generic header for non-RA tickets */
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.push("/sac/tickets")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{ticket.subject}</h1>
              <p className="text-sm text-muted-foreground">Ticket #{ticket.id.slice(-8)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ChannelBadge channelType={ticket.channelType ?? null} />
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${priorityColor(ticket.priority)}`}>
              {priorityLabel(ticket.priority)}
            </span>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${statusColor(ticket.status)}`}>
              {statusLabel(ticket.status)}
            </span>
          </div>
        </div>
      )}

      {/* Cross-channel dedup banners */}
      {ticket.mergedIntoId && ticket.mergedAt && (
        <MergedTicketBanner mergedIntoId={ticket.mergedIntoId} mergedAt={ticket.mergedAt} />
      )}
      {selectedCompanyId && !ticket.mergedIntoId && (
        <LinkedTicketsBanner ticketId={ticket.id} companyId={selectedCompanyId} />
      )}

      {/* Unknown contact banner (US-081) */}
      {isUnknownClient && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">Contato não identificado</p>
            <p className="text-xs text-amber-700">
              {ticket.description.includes("Número:")
                ? `Número: ${ticket.description.match(/Número:\s*(\+?[\d]+)/)?.[1] ?? "desconhecido"}`
                : ticket.description.includes("Email recebido de")
                  ? `Email: ${ticket.description.match(/Email recebido de\s+([\w.+-]+@[\w.-]+)/)?.[1] ?? "desconhecido"}`
                  : "Remetente não identificado"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="border-amber-400 text-amber-800 hover:bg-amber-100" onClick={() => setLinkDialogOpen(true)}>
              <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
              Vincular
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-800 hover:bg-amber-100"
              onClick={() => {
                const phoneMatch = ticket.description.match(/Número:\s*(\+?[\d]+)/);
                const emailMatch = ticket.description.match(/Email recebido de\s+([\w.+-]+@[\w.-]+)/);
                setNewClientForm((prev) => ({ ...prev, email: emailMatch?.[1] ?? "", telefone: phoneMatch?.[1] ?? "" }));
                setCreateDialogOpen(true);
              }}
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              Criar cliente
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          RECLAME AQUI LAYOUT (US-RA-R01 through R05)
          ═══════════════════════════════════════════════════════════ */}
      {isRa ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* ─── Main Content ─────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Descrição da Reclamação</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.description}</p>
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
                      <Button key={t.value} variant="outline" disabled={updatingStatus} onClick={() => handleStatusChange(t.value)}>
                        {updatingStatus ? "Atualizando..." : t.label}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* US-RA-R04: RA Action Bar */}
            <RaActionBar
              ticketId={ticketId}
              companyId={selectedCompanyId}
              raExternalId={ticket.raExternalId ?? null}
              raCanEvaluate={ticket.raCanEvaluate === true}
              raCanModerate={ticket.raCanModerate === true}
              onRequestEvaluation={handleRequestRaEvaluation}
              onRequestModeration={() => setRaModerationOpen(true)}
              onFinishPrivate={handleFinishPrivate}
              requestingEval={requestingEval}
              finishingPrivate={finishingPrivate}
            />

            {/* US-RA-R03: AI Suggestion Card in prominence */}
            {raSuggestion && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    <span className="text-sm font-semibold text-purple-800">Sugestão da IA</span>
                    <Badge variant="outline" className="text-xs border-purple-300 text-purple-700 bg-purple-50">
                      Pendente de aprovação
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-300 text-purple-700 hover:bg-purple-100 text-xs"
                    onClick={() => {
                      const publicMsg = extractPublicFromSuggestion(raSuggestion.content);
                      setInitialPublicMessage(publicMsg);
                      toast.info("Sugestão copiada para a aba de Resposta Pública");
                    }}
                  >
                    <ChevronRight className="mr-1 h-3 w-3" />
                    Usar esta sugestão
                  </Button>
                </div>
                <RaSuggestionCard
                  messageId={raSuggestion.id}
                  companyId={selectedCompanyId}
                  content={raSuggestion.content}
                  createdAt={raSuggestion.createdAt}
                  onActionComplete={loadTicket}
                />
              </div>
            )}

            {/* US-RA-R02: Response Panel with tabs */}
            <Card className="border-purple-100">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-purple-600" />
                  Responder Reclamação
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RaResponsePanel
                  ticketId={ticketId}
                  companyId={selectedCompanyId}
                  initialPublicMessage={initialPublicMessage}
                  onSendPublic={handleSendRaPublicMessage}
                  onSendPrivate={(msg, files) => handleSendRaPrivateMessage(msg, files)}
                  sendingPublic={sendingRaPublic}
                  sendingPrivate={sendingRaPrivate}
                />
              </CardContent>
            </Card>

            {/* Timeline (history) */}
            <TicketTimeline
              ticketId={ticketId}
              companyId={selectedCompanyId}
              ticketSubject={ticket.subject}
              aiEnabled={ticket.aiEnabled}
              aiConfigEnabled={aiConfigEnabled}
              channelType={ticket.channelType ?? null}
            />
          </div>

          {/* ─── US-RA-R05: RA Sidebar ──────────────────────────── */}
          <div className="space-y-6">
            {/* 1. Consumer info */}
            <Card className="border-purple-100">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-purple-700 flex items-center gap-2 uppercase tracking-wide">
                  <User className="h-3.5 w-3.5" />
                  Consumidor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 font-bold text-sm">
                    {(raContext?.client?.name ?? ticket.client.name).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{raContext?.client?.name ?? ticket.client.name}</p>
                    {(raContext?.client?.email ?? ticket.client.email) && (
                      <p className="text-xs text-muted-foreground">{raContext?.client?.email ?? ticket.client.email}</p>
                    )}
                    {raContext?.client?.phone && (
                      <p className="text-xs text-muted-foreground">{raContext.client.phone}</p>
                    )}
                    {raContext?.client?.cpfCnpj && !raContext.client.cpfCnpj.startsWith("RA-") && (
                      <p className="text-xs text-muted-foreground font-mono">{raContext.client.cpfCnpj}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. RA Status & metrics */}
            <Card className="border-purple-100">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-purple-700 flex items-center gap-2 uppercase tracking-wide">
                  <Globe className="h-3.5 w-3.5" />
                  Status Reclame Aqui
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {ticket.raStatusName && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Status RA</span>
                    <span className="text-xs font-semibold text-purple-700">{ticket.raStatusName}</span>
                  </div>
                )}
                {ticket.raRating != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Avaliação</span>
                    <span className="text-xs font-semibold">⭐ {ticket.raRating}/10</span>
                  </div>
                )}
                {raContext?.raFeeling && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Sentimento</span>
                    <span className="text-xs font-medium">{getFeelingEmoji(raContext.raFeeling)} {raContext.raFeeling}</span>
                  </div>
                )}
                {raContext?.raResolvedIssue != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Resolvido</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${raContext.raResolvedIssue ? "text-green-700" : "text-red-700"}`}>
                      {raContext.raResolvedIssue ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
                      {raContext.raResolvedIssue ? "Sim" : "Não"}
                    </span>
                  </div>
                )}
                {raContext?.raBackDoingBusiness != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Voltaria a comprar</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${raContext.raBackDoingBusiness ? "text-green-700" : "text-red-700"}`}>
                      {raContext.raBackDoingBusiness ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
                      {raContext.raBackDoingBusiness ? "Sim" : "Não"}
                    </span>
                  </div>
                )}
                {raContext?.raCategories?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Categorias</p>
                    <div className="flex flex-wrap gap-1">
                      {raContext.raCategories.map((cat: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">{cat}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {raContext?.raFrozen && (
                  <Badge variant="destructive" className="w-full justify-center text-xs">🧊 Ticket congelado</Badge>
                )}
              </CardContent>
            </Card>

            {/* 3. SLA Reclame Aqui */}
            {ticket.raSlaDeadline && !["RESOLVED", "CLOSED"].includes(ticket.status) && (
              <Card className={(() => {
                const dl = new Date(ticket.raSlaDeadline);
                const now = new Date();
                const target = new Date(dl); target.setHours(0,0,0,0);
                const cursor = new Date(now); cursor.setHours(0,0,0,0);
                let days = 0;
                if (cursor >= target) { const d = new Date(target); while (d < cursor) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days--; } }
                else { const d = new Date(cursor); while (d < target) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days++; } }
                if (days <= 0) return "border-red-500 bg-red-50";
                if (days <= 2) return "border-red-300 bg-red-50/50";
                if (days <= 5) return "border-yellow-300 bg-yellow-50";
                return "border-purple-100";
              })()}>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-purple-700 flex items-center gap-2 uppercase tracking-wide">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    SLA Reclame Aqui
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const dl = new Date(ticket.raSlaDeadline!);
                    const now = new Date();
                    const target = new Date(dl); target.setHours(0,0,0,0);
                    const cursor = new Date(now); cursor.setHours(0,0,0,0);
                    let days = 0;
                    if (cursor >= target) { const d = new Date(target); while (d < cursor) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days--; } }
                    else { const d = new Date(cursor); while (d < target) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days++; } }
                    let badgeColor = "bg-emerald-100 text-emerald-800";
                    let text = `${days} dias úteis restantes`;
                    if (days <= 0) { badgeColor = "bg-black text-white"; text = days === 0 ? "Vence hoje!" : `Expirado há ${Math.abs(days)} dia(s)`; }
                    else if (days <= 2) { badgeColor = "bg-red-100 text-red-800"; text = `${days} dia(s) restante(s) ⚠️`; }
                    else if (days <= 5) { badgeColor = "bg-yellow-100 text-yellow-800"; text = `${days} dias restantes`; }
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs">Prazo (10 dias úteis)</span>
                          <span className={`px-2 py-1 rounded text-xs font-bold ${badgeColor}`}>{text}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Vencimento: {dl.toLocaleDateString("pt-BR")}</p>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* 4. Responsável */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Responsável</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="assignee-ra">Atribuir a</Label>
                  <Select value={ticket.assignee?.id ?? "__none__"} onValueChange={handleReassign} disabled={updatingAssignee}>
                    <SelectTrigger id="assignee-ra">
                      <SelectValue placeholder="Selecione um responsável" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* 5. Tags */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Tags</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {tags.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma tag</p>}
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                      {tag}
                      <button type="button" onClick={() => handleRemoveTag(tag)} className="ml-0.5 rounded-full p-0.5 hover:bg-muted">
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
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
                    className="h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={handleAddTag} disabled={!newTag.trim()} className="h-8 px-2">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 6. General info (compact) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Informações Gerais</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Empresa</p>
                    <p className="text-sm">{ticket.company.nomeFantasia}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Criado em</p>
                    <p className="text-sm">{dateFmt.format(new Date(ticket.createdAt))}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Atualizado em</p>
                    <p className="text-sm">{dateFmt.format(new Date(ticket.updatedAt))}</p>
                  </div>
                </div>
                {ticket.proposalId && (
                  <div className="flex items-start gap-3">
                    <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Proposta Vinculada</p>
                      <p className="text-sm text-primary">#{ticket.proposalId.slice(-8)}</p>
                    </div>
                  </div>
                )}
                {ticket.boletoId && (
                  <div className="flex items-start gap-3">
                    <CreditCard className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Boleto Vinculado</p>
                      <p className="text-sm text-primary">#{ticket.boletoId.slice(-8)}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Financial (RA context — kept) */}
            {financial && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Situação Financeira
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
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
                    {financial.status === "adimplente" ? "Adimplente" : financial.status === "atraso" ? "Em Atraso" : "Inadimplente"}
                  </Badge>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Pendente</p>
                      <p className="font-medium">R$ {financial.pendingTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Vencido</p>
                      <p className="font-medium text-red-600">R$ {financial.overdueTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                  {financial.lastPayment && (
                    <div className="text-sm">
                      <p className="text-xs text-muted-foreground">Último Pagamento</p>
                      <p>{dateFmt.format(new Date(financial.lastPayment))}</p>
                    </div>
                  )}
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => router.push("/financeiro/receber")}>
                    <ExternalLink className="mr-1 h-3 w-3" />
                    Ver financeiro
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* 7. Export PDF */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileDown className="h-4 w-4" />
                  Exportar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full" onClick={() => setExportDialogOpen(true)}>
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />
                  Exportar PDF
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        /* ═══════════════════════════════════════════════════════════
            GENERIC LAYOUT (EMAIL / WHATSAPP)
            ═══════════════════════════════════════════════════════════ */
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Descricao</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.description}</p>
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
                      <Button key={t.value} variant="outline" disabled={updatingStatus} onClick={() => handleStatusChange(t.value)}>
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
                    <p className="text-xs font-medium text-muted-foreground">Cliente</p>
                    <p className="text-sm font-medium">{ticket.client.name}</p>
                    <p className="text-xs text-muted-foreground">{ticket.client.cpfCnpj}</p>
                  </div>
                </div>

                {ticket.contact && (
                  <div className="flex items-start gap-3">
                    <UserCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Contato</p>
                      <p className="text-sm font-medium">{ticket.contact.name}</p>
                      {ticket.contact.role && <p className="text-xs text-muted-foreground">{ticket.contact.role}</p>}
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Empresa</p>
                    <p className="text-sm">{ticket.company.nomeFantasia}</p>
                  </div>
                </div>

                {ticket.channelType && (
                  <div className="flex items-start gap-3">
                    {ticket.channelType === "EMAIL" ? (
                      <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    ) : (
                      <MessageSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Canal de Origem</p>
                      <p className="text-sm">{ticket.channelType === "EMAIL" ? "Email" : "WhatsApp"}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Criado em</p>
                    <p className="text-sm">{dateFmt.format(new Date(ticket.createdAt))}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Atualizado em</p>
                    <p className="text-sm">{dateFmt.format(new Date(ticket.updatedAt))}</p>
                  </div>
                </div>

                {ticket.proposalId && (
                  <div className="flex items-start gap-3">
                    <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Proposta Vinculada</p>
                      <p className="text-sm text-primary">#{ticket.proposalId.slice(-8)}</p>
                    </div>
                  </div>
                )}

                {ticket.boletoId && (
                  <div className="flex items-start gap-3">
                    <CreditCard className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Boleto Vinculado</p>
                      <p className="text-sm text-primary">#{ticket.boletoId.slice(-8)}</p>
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
                  <Select value={ticket.assignee?.id ?? "__none__"} onValueChange={handleReassign} disabled={updatingAssignee}>
                    <SelectTrigger id="assignee">
                      <SelectValue placeholder="Selecione um responsavel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
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
                  {tags.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma tag</p>}
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                      {tag}
                      <button type="button" onClick={() => handleRemoveTag(tag)} className="ml-0.5 rounded-full p-0.5 hover:bg-muted">
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
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
                    className="h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={handleAddTag} disabled={!newTag.trim()} className="h-8 px-2">
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
                    <SlaCard label="1a Resposta" deadline={ticket.slaFirstReply} breached={ticket.slaBreached} />
                  )}
                  {ticket.slaResolution && (
                    <SlaCard label="Resolucao" deadline={ticket.slaResolution} breached={ticket.slaBreached} />
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
                    {financial.status === "adimplente" ? "Adimplente" : financial.status === "atraso" ? "Em Atraso" : "Inadimplente"}
                  </Badge>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Pendente</p>
                      <p className="font-medium">R$ {financial.pendingTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Vencido</p>
                      <p className="font-medium text-red-600">R$ {financial.overdueTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                  {financial.lastPayment && (
                    <div className="text-sm">
                      <p className="text-xs text-muted-foreground">Ultimo Pagamento</p>
                      <p>{dateFmt.format(new Date(financial.lastPayment))}</p>
                    </div>
                  )}
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => router.push("/financeiro/receber")}>
                    <ExternalLink className="mr-1 h-3 w-3" />
                    Ver financeiro
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Refund Section (US-085) — Only for non-RA tickets */}
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
                    <div className="flex items-center justify-between">
                      <Badge
                        variant={refund.status === "COMPLETED" ? "default" : refund.status === "REJECTED" ? "destructive" : "secondary"}
                        className={
                          refund.status === "COMPLETED" ? "bg-green-100 text-green-800 hover:bg-green-100" :
                          refund.status === "APPROVED" ? "bg-blue-100 text-blue-800 hover:bg-blue-100" :
                          refund.status === "AWAITING_APPROVAL" ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" : ""
                        }
                      >
                        {refund.status === "AWAITING_APPROVAL" ? "Aguardando Aprovacao" :
                         refund.status === "APPROVED" ? "Aprovado" :
                         refund.status === "REJECTED" ? "Rejeitado" :
                         refund.status === "PROCESSING" ? "Processando" : "Concluido"}
                      </Badge>
                      <span className="text-sm font-semibold">R$ {refund.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>Solicitante: {refund.requestedBy.name}</p>
                      <p>Data: {dateFmt.format(new Date(refund.requestedAt))}</p>
                      {refund.approvedBy && (
                        <p>{refund.status === "REJECTED" ? "Rejeitado" : "Aprovado"} por: {refund.approvedBy.name}</p>
                      )}
                      {refund.rejectionReason && <p className="text-red-600">Motivo: {refund.rejectionReason}</p>}
                      {refund.paymentMethod && <p>Metodo: {refund.paymentMethod}</p>}
                    </div>
                    {refund.slaDeadline && !["COMPLETED", "REJECTED"].includes(refund.status) && (
                      <div className="text-xs">
                        {(() => {
                          const dl = new Date(refund.slaDeadline);
                          const diffMs = dl.getTime() - Date.now();
                          const isBreached = refund.slaBreached || diffMs <= 0;
                          const atRisk = !isBreached && diffMs < 60 * 60_000;
                          return (
                            <span className={isBreached ? "text-red-600 font-medium" : atRisk ? "text-yellow-600 font-medium" : "text-green-600"}>
                              SLA: {isBreached ? "Estourado" : atRisk ? "Em Risco" : "OK"}
                              {" - "}
                              {isBreached
                                ? `-${Math.floor(Math.abs(diffMs) / 3_600_000)}h${String(Math.floor((Math.abs(diffMs) % 3_600_000) / 60_000)).padStart(2, "0")}m`
                                : `${Math.floor(diffMs / 3_600_000)}h${String(Math.floor((diffMs % 3_600_000) / 60_000)).padStart(2, "0")}m`}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                    {refund.status === "AWAITING_APPROVAL" && isAdminOrManager && (
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" className="flex-1 border-green-300 text-green-700 hover:bg-green-50" disabled={approvingRefundId === refund.id} onClick={() => handleApproveRefund(refund.id)}>
                          {approvingRefundId === refund.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
                          Aprovar
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 border-red-300 text-red-700 hover:bg-red-50" onClick={() => { setRejectRefundId(refund.id); setRejectDialogOpen(true); }}>
                          <XCircle className="mr-1 h-3 w-3" />
                          Rejeitar
                        </Button>
                      </div>
                    )}
                    {refund.status === "APPROVED" && isAdminOrManager && (
                      <Button size="sm" className="w-full" onClick={() => { setExecuteRefundId(refund.id); setExecuteDialogOpen(true); }}>
                        <Banknote className="mr-1.5 h-3.5 w-3.5" />
                        Executar Reembolso
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" className="w-full" onClick={() => setRequestRefundOpen(true)}>
                  <Coins className="mr-1.5 h-3.5 w-3.5" />
                  Solicitar Reembolso
                </Button>
              </CardContent>
            </Card>

            {/* Cancellation Section (US-086) — Only for non-RA */}
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
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Aguardando Aprovação</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {cancellation.type && (
                          <p>Tipo: {cancellation.type === "proposal" ? "Proposta" : cancellation.type === "boletos" ? "Boletos" : "Proposta e Boletos"}</p>
                        )}
                        {cancellation.requestedBy && <p>Solicitante: {cancellation.requestedBy}</p>}
                        {cancellation.requestedAt && <p>Data: {dateFmt.format(new Date(cancellation.requestedAt))}</p>}
                        {cancellation.justification && <p>Justificativa: {cancellation.justification}</p>}
                      </div>
                      {isAdminOrManager && (
                        <Button size="sm" variant="outline" className="w-full border-green-300 text-green-700 hover:bg-green-50" disabled={approvingCancel} onClick={handleApproveCancellation}>
                          {approvingCancel ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1.5 h-3.5 w-3.5" />}
                          Aprovar Cancelamento
                        </Button>
                      )}
                    </div>
                  )}
                  {!hasPendingCancellation && (
                    <Button variant="outline" className="w-full border-red-200 text-red-700 hover:bg-red-50" onClick={() => setCancelDialogOpen(true)}>
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
                <Button variant="outline" className="w-full" onClick={() => setExportDialogOpen(true)}>
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />
                  Exportar PDF
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ─── Dialogs (always rendered, used by both layouts) ──────── */}

      {/* Export PDF dialog (US-089) */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Exportar Ticket como PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox id="export-notes" checked={exportIncludeNotes} onCheckedChange={(c) => setExportIncludeNotes(c === true)} />
              <Label htmlFor="export-notes" className="text-sm font-normal cursor-pointer">Incluir notas internas</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="export-attachments" checked={exportIncludeAttachments} onCheckedChange={(c) => setExportIncludeAttachments(c === true)} />
              <Label htmlFor="export-attachments" className="text-sm font-normal cursor-pointer">Incluir lista de anexos</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleExportPdf} disabled={exporting}>
              {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
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
              <Input placeholder="Buscar por nome ou CNPJ/CPF..." value={linkSearch} onChange={(e) => handleLinkSearch(e.target.value)} className="pl-9" />
            </div>
            {linkSearching && (
              <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Buscando...
              </div>
            )}
            {!linkSearching && linkSearch.length >= 2 && linkResults.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhum cliente encontrado</p>
            )}
            {linkResults.length > 0 && (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {linkResults.map((client) => (
                  <button key={client.id} type="button" disabled={linking} onClick={() => handleLinkToClient(client.id)} className="w-full rounded-md border p-3 text-left hover:bg-muted transition-colors">
                    <p className="text-sm font-medium">{client.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {client.cpfCnpj}{client.email && ` · ${client.email}`}{client.telefone && ` · ${client.telefone}`}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="new-client-name">Nome *</Label>
                <Input id="new-client-name" value={newClientForm.name} onChange={(e) => setNewClientForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nome do cliente" />
              </div>
              <div>
                <Label htmlFor="new-client-type">Tipo *</Label>
                <Select value={newClientForm.type} onValueChange={(v) => setNewClientForm((f) => ({ ...f, type: v as "PF" | "PJ" }))}>
                  <SelectTrigger id="new-client-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PJ">Pessoa Jurídica</SelectItem>
                    <SelectItem value="PF">Pessoa Física</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="new-client-cpfcnpj">{newClientForm.type === "PF" ? "CPF" : "CNPJ"} *</Label>
                <Input id="new-client-cpfcnpj" value={newClientForm.cpfCnpj} onChange={(e) => setNewClientForm((f) => ({ ...f, cpfCnpj: e.target.value }))} placeholder={newClientForm.type === "PF" ? "000.000.000-00" : "00.000.000/0000-00"} />
              </div>
              <div>
                <Label htmlFor="new-client-email">Email</Label>
                <Input id="new-client-email" type="email" value={newClientForm.email} onChange={(e) => setNewClientForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="new-client-telefone">Telefone</Label>
                <Input id="new-client-telefone" value={newClientForm.telefone} onChange={(e) => setNewClientForm((f) => ({ ...f, telefone: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="new-client-razao">Razão Social</Label>
                <Input id="new-client-razao" value={newClientForm.razaoSocial} onChange={(e) => setNewClientForm((f) => ({ ...f, razaoSocial: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="new-client-endereco">Endereço</Label>
                <Input id="new-client-endereco" value={newClientForm.endereco} onChange={(e) => setNewClientForm((f) => ({ ...f, endereco: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateAndLink} disabled={linking || !newClientForm.name.trim() || !newClientForm.cpfCnpj.trim()}>
              {linking ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Criando...</>) : "Criar e Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Refund Dialog (US-085) */}
      <RequestRefundDialog
        open={requestRefundOpen}
        onOpenChange={setRequestRefundOpen}
        ticketId={ticketId}
        companyId={selectedCompanyId!}
        boletoId={ticket?.boletoId}
        onSuccess={() => {
          getTicketRefunds(ticketId, selectedCompanyId!).then(setRefunds).catch(() => {});
          loadTicket();
        }}
      />

      {/* Reject Refund Dialog (US-085) */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rejeitar Reembolso</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reject-reason">Motivo da Rejeicao *</Label>
              <Textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Descreva o motivo da rejeição..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleRejectRefund} disabled={submittingReject || !rejectReason.trim()}>
              {submittingReject ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Rejeitando...</>) : "Confirmar Rejeicao"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Execute Refund Dialog (US-085) */}
      <ExecuteRefundDialog
        open={executeDialogOpen}
        onOpenChange={setExecuteDialogOpen}
        refundId={executeRefundId}
        ticketId={ticketId}
        companyId={selectedCompanyId!}
        onSuccess={() => {
          getTicketRefunds(ticketId, selectedCompanyId!).then(setRefunds).catch(() => {});
          loadTicket();
        }}
      />

      {/* RA Moderation Dialog */}
      {ticket.channelType === "RECLAMEAQUI" && (
        <RaModerationDialog
          open={raModerationOpen}
          onOpenChange={setRaModerationOpen}
          ticketId={ticketId}
          companyId={selectedCompanyId!}
          onSuccess={loadTicket}
        />
      )}

      {/* Request Cancellation Dialog (US-086) */}
      <CancellationDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        ticketId={ticketId}
        companyId={selectedCompanyId!}
        proposalId={ticket?.proposalId}
        boletoId={ticket?.boletoId}
        onSuccess={() => {
          getCancellationInfo(ticketId, selectedCompanyId!).then(setCancellation).catch(() => {});
          loadTicket();
        }}
      />
    </div>
  );
}
