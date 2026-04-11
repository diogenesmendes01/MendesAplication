"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  ArrowLeft,
  AlertTriangle,
  LinkIcon,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/company-context";
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
import { statusLabel } from "@/lib/sac/ticket-formatters";
import TicketTimeline from "./ticket-timeline";
import RaModerationDialog from "./ra-moderation-dialog";
import { ChannelBreadcrumb } from "@/components/sac/channel-breadcrumb";
import {
  getRaTicketContext,
  requestRaEvaluation,
  finishPrivateMessage,
  sendPrivateMessageWithAttachments,
  sendRaResponse,
} from "../ra-actions";
import LinkedTicketsBanner from "./linked-tickets-banner";
import MergedTicketBanner from "./merged-ticket-banner";

// New sub-components (Tasks 1-9)
import { ChannelThemeProvider } from "./components/channel-theme-provider";
import TicketHeader from "./components/ticket-header";
import TicketTabs, { type TabId } from "./components/ticket-tabs";
import TicketDetailsTab from "./components/ticket-details-tab";
import TicketSidebar from "./components/ticket-sidebar";
import TicketComposerTab from "./components/ticket-composer-tab";
import {
  ExportPdfDialog,
  LinkClientDialog,
  CreateClientDialog,
  RejectRefundDialog,
} from "./components/ticket-dialogs";

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
  const [_loadingRaContext, setLoadingRaContext] = useState(false);

  // AI suggestion pre-populate state (US-RA-R03)
  const [initialPublicMessage, setInitialPublicMessage] = useState<string>("");

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("detalhes");

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

  const isRa = ticket.channelType === "RECLAMEAQUI";

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <ChannelThemeProvider channelType={ticket.channelType}>
      <div style={{ background: "#FAFAF8", minHeight: "100vh" }}>
        {/* Breadcrumb */}
        <ChannelBreadcrumb channelType={ticket.channelType ?? null} ticketId={ticket.id} />

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

        {/* Header */}
        <TicketHeader
          ticket={ticket}
          raContext={raContext}
          updatingStatus={updatingStatus}
          onStatusChange={handleStatusChange}
          onExport={() => setExportDialogOpen(true)}
          onRequestEvaluation={isRa ? handleRequestRaEvaluation : undefined}
          requestingEval={requestingEval}
          onOpenModeration={isRa ? () => setRaModerationOpen(true) : undefined}
          onCancelDialog={!isRa ? () => setCancelDialogOpen(true) : undefined}
          hasProposalOrBoleto={hasProposalOrBoleto}
        />

        {/* Tabs */}
        <TicketTabs activeTab={activeTab} onTabChange={setActiveTab} showResponder={isRa} />

        {/* Content grid: main + sidebar */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", minHeight: 380 }}>
          {/* Content area — switches by tab */}
          <div>
            {activeTab === "detalhes" && (
              <TicketDetailsTab
                ticket={ticket}
                raContext={raContext}
                companyId={selectedCompanyId}
                onUseSuggestion={(msg) => { setInitialPublicMessage(msg); setActiveTab("responder"); }}
                onSuggestionAction={loadTicket}
              />
            )}
            {activeTab === "timeline" && (
              <TicketTimeline
                ticketId={ticketId}
                companyId={selectedCompanyId}
                ticketSubject={ticket.subject}
                aiEnabled={ticket.aiEnabled}
                aiConfigEnabled={aiConfigEnabled}
                channelType={ticket.channelType ?? null}
              />
            )}
            {activeTab === "responder" && (
              <TicketComposerTab
                ticket={ticket}
                ticketId={ticketId}
                companyId={selectedCompanyId}
                initialPublicMessage={initialPublicMessage}
                onSendPublic={handleSendRaPublicMessage}
                onSendPrivate={handleSendRaPrivateMessage}
                sendingPublic={sendingRaPublic}
                sendingPrivate={sendingRaPrivate}
                requestingEval={requestingEval}
                finishingPrivate={finishingPrivate}
                onRequestEvaluation={handleRequestRaEvaluation}
                onOpenModeration={() => setRaModerationOpen(true)}
                onFinishPrivate={handleFinishPrivate}
              />
            )}
          </div>

          {/* Sidebar — always visible */}
          <TicketSidebar
            ticket={ticket}
            users={users}
            updatingAssignee={updatingAssignee}
            onReassign={handleReassign}
            tags={tags}
            newTag={newTag}
            onNewTagChange={setNewTag}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            financial={financial}
            refunds={refunds}
            isAdminOrManager={isAdminOrManager}
            approvingRefundId={approvingRefundId}
            onApproveRefund={handleApproveRefund}
            onOpenRejectRefund={(id) => { setRejectRefundId(id); setRejectDialogOpen(true); }}
            onOpenExecuteRefund={(id) => { setExecuteRefundId(id); setExecuteDialogOpen(true); }}
            onRequestRefund={() => setRequestRefundOpen(true)}
            cancellation={cancellation}
            hasPendingCancellation={hasPendingCancellation}
            hasProposalOrBoleto={hasProposalOrBoleto}
            approvingCancel={approvingCancel}
            onApproveCancellation={handleApproveCancellation}
            onOpenCancelDialog={() => setCancelDialogOpen(true)}
            onExport={() => setExportDialogOpen(true)}
          />
        </div>

        {/* ─── Dialogs ──────────────────────────────────────────── */}

        <ExportPdfDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          includeNotes={exportIncludeNotes}
          onIncludeNotesChange={setExportIncludeNotes}
          includeAttachments={exportIncludeAttachments}
          onIncludeAttachmentsChange={setExportIncludeAttachments}
          exporting={exporting}
          onExport={handleExportPdf}
        />

        <LinkClientDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          search={linkSearch}
          onSearch={handleLinkSearch}
          searching={linkSearching}
          results={linkResults}
          linking={linking}
          onLink={handleLinkToClient}
        />

        <CreateClientDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          form={newClientForm}
          onFormChange={setNewClientForm}
          linking={linking}
          onCreateAndLink={handleCreateAndLink}
        />

        <RejectRefundDialog
          open={rejectDialogOpen}
          onOpenChange={setRejectDialogOpen}
          reason={rejectReason}
          onReasonChange={setRejectReason}
          submitting={submittingReject}
          onReject={handleRejectRefund}
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
    </ChannelThemeProvider>
  );
}
