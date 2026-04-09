"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  User,
  FileText,
  MessageSquare,
  AlertTriangle,
  Link as LinkIcon,
  UserPlus,
  Loader2,
  Sparkles,
  ThumbsUp,
  ChevronRight,
  Info,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/contexts/company-context";
import {
  getTicketDetailBootstrap,
  updateTicketStatus,
  type TicketDetail,
  type ClientFinancialSummary,
  type RefundSummary,
  type CancellationInfo,
} from "../actions";
import type { TicketStatus } from "@prisma/client";
import TicketTimeline from "./ticket-timeline";
import { ChannelBreadcrumb } from "@/components/sac/channel-breadcrumb";
import { priorityLabel, priorityColor, statusLabel, statusColor } from "@/lib/sac/ticket-formatters";
import {
  getRaTicketContext,
  requestRaEvaluation,
  finishPrivateMessage,
  sendPrivateMessageWithAttachments,
  sendRaResponse,
} from "../ra-actions";
import LinkedTicketsBanner from "./linked-tickets-banner";
import MergedTicketBanner from "./merged-ticket-banner";
import RaResponsePanel from "./ra-response-panel";
import { TicketHeader } from "./components/ticket-header";
import { TicketSidebar } from "./components/ticket-sidebar";
import { TicketDialogs, type TicketDialogsHandle } from "./components/ticket-dialogs";
import { RaSidebar } from "./components/ra-sidebar";
import RaSuggestionCard from "./ra-suggestion-card";

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


// ---------------------------------------------------------------------------
// Mini-cards helpers
// ---------------------------------------------------------------------------

type RaFormField = { name: string; value: string };

function isRaFormFields(val: unknown): val is RaFormField[] {
  return (
    Array.isArray(val) &&
    val.every(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        "name" in f &&
        "value" in f &&
        typeof (f as Record<string, unknown>).name === "string" &&
        typeof (f as Record<string, unknown>).value === "string"
    )
  );
}


// ---------------------------------------------------------------------------
// Reusable Mini-card grid components
// ---------------------------------------------------------------------------

type RaMiniCardsTicket = {
  client: { name: string; email?: string | null };
  company: { nomeFantasia: string };
  raFormFields: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type RaMiniCardsContext = {
  client?: { name?: string; email?: string; phone?: string } | null;
} | null;

function RaMiniCards({
  ticket,
  raContext,
}: {
  ticket: RaMiniCardsTicket;
  raContext: RaMiniCardsContext;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Consumidor */}
      <Card className="border-purple-100 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-purple-700 flex items-center gap-1.5">
            <User className="h-3 w-3" />Consumidor
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-3 space-y-0.5">
          <p className="text-sm font-semibold">{raContext?.client?.name ?? ticket.client.name}</p>
          {(raContext?.client?.email ?? ticket.client.email) && (
            <p className="text-xs text-muted-foreground">{raContext?.client?.email ?? ticket.client.email}</p>
          )}
          {raContext?.client?.phone && (
            <p className="text-xs text-muted-foreground">{raContext.client.phone}</p>
          )}
        </CardContent>
      </Card>

      {/* Dados da Reclamação */}
      <Card className="border-purple-100 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-purple-700 flex items-center gap-1.5">
            <FileText className="h-3 w-3" />Dados da Reclamação
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-3 space-y-1.5">
          {isRaFormFields(ticket.raFormFields) && ticket.raFormFields.length > 0 ? (
            ticket.raFormFields.slice(0, 3).map((f, i) => (
              <div key={i}>
                <p className="text-xs text-muted-foreground">{f.name}</p>
                <p className="text-xs font-medium">{f.value}</p>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Sem dados adicionais</p>
          )}
        </CardContent>
      </Card>

      {/* Informações Gerais */}
      <Card className="border-purple-100 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-purple-700 flex items-center gap-1.5">
            <Info className="h-3 w-3" />Informações Gerais
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-3 space-y-1">
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Empresa</span><span className="font-medium truncate ml-2">{ticket.company.nomeFantasia}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Canal</span><span className="font-medium text-purple-700">Reclame Aqui</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Criado</span><span className="font-medium">{dateFmt.format(new Date(ticket.createdAt))}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Atualizado</span><span className="font-medium">{dateFmt.format(new Date(ticket.updatedAt))}</span></div>
        </CardContent>
      </Card>
    </div>
  );
}

type GenericMiniCardsTicket = {
  client: { name: string; email?: string | null };
  contact?: { name: string; role?: string | null } | null;
  company: { nomeFantasia: string };
  channelType?: string | null;
  priority: string;
  status: string;
  proposalId?: string | null;
  boletoId?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

function GenericMiniCards({ ticket }: { ticket: GenericMiniCardsTicket }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Cliente */}
      <Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <User className="h-3 w-3" />Cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-3 space-y-0.5">
          <p className="text-sm font-semibold">{ticket.client.name}</p>
          {ticket.contact && (
            <>
              <p className="text-xs text-muted-foreground">{ticket.contact.name}</p>
              {ticket.contact.role && <p className="text-xs text-muted-foreground">{ticket.contact.role}</p>}
            </>
          )}
          {ticket.client.email && (
            <p className="text-xs text-muted-foreground truncate">{ticket.client.email}</p>
          )}
        </CardContent>
      </Card>

      {/* Dados */}
      <Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <FileText className="h-3 w-3" />Dados
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-3 space-y-1">
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Prioridade</span><span className={`font-medium px-1.5 py-0.5 rounded-full ${priorityColor(ticket.priority)}`}>{priorityLabel(ticket.priority)}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Status</span><span className={`font-medium px-1.5 py-0.5 rounded-full ${statusColor(ticket.status)}`}>{statusLabel(ticket.status)}</span></div>
          {ticket.proposalId && (
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Proposta</span><span className="font-medium text-primary">#{ticket.proposalId?.slice(-8) || "---"}</span></div>
          )}
          {ticket.boletoId && (
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Boleto</span><span className="font-medium text-primary">#{ticket.boletoId?.slice(-8) || "---"}</span></div>
          )}
        </CardContent>
      </Card>

      {/* Informações */}
      <Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Info className="h-3 w-3" />Informações
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-3 space-y-1">
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Empresa</span><span className="font-medium truncate ml-2">{ticket.company.nomeFantasia}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Canal</span><span className="font-medium">{ticket.channelType === "EMAIL" ? "Email" : "WhatsApp"}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Criado</span><span className="font-medium">{dateFmt.format(new Date(ticket.createdAt))}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Atualizado</span><span className="font-medium">{dateFmt.format(new Date(ticket.updatedAt))}</span></div>
        </CardContent>
      </Card>
    </div>
  );
}

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
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [financial, setFinancial] = useState<ClientFinancialSummary | null>(null);
  const [aiConfigEnabled, setAiConfigEnabled] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [raContext, setRaContext] = useState<any>(null);
  const [_loadingRaContext, setLoadingRaContext] = useState(false);

  // AI suggestion pre-populate state (US-RA-R03)
  const [initialPublicMessage, setInitialPublicMessage] = useState<string>("");

  // Refund state (US-085)
  const [refunds, setRefunds] = useState<RefundSummary[]>([]);
  const [userRole, setUserRole] = useState<string>("");

  // Cancellation state (US-086)
  const [cancellation, setCancellation] = useState<CancellationInfo | null>(null);

  // RA actions state
  const [requestingEval, setRequestingEval] = useState(false);

  // Dialogs ref
  const dialogsRef = useRef<TicketDialogsHandle>(null);
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
  // Contact linking (US-081) — helper
  // ---------------------------------------------------

  const isUnknownClient = ticket?.client.cpfCnpj === "00000000000";

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

      {/* ─── RA Identity Header (US-RA-R01) / Generic Header ──────── */}
      <TicketHeader
        ticket={ticket}
        isRa={isRa}
        raContext={raContext}
        transitions={transitions}
        updatingStatus={updatingStatus}
        onStatusChange={handleStatusChange}
        onBack={() => router.push("/sac/tickets")}
      />

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
            <Button size="sm" variant="outline" className="border-amber-400 text-amber-800 hover:bg-amber-100" onClick={() => dialogsRef.current?.openLinkDialog()}>
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
                dialogsRef.current?.openCreateClientDialog({
                  email: emailMatch?.[1] ?? "",
                  telefone: phoneMatch?.[1] ?? "",
                });
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
            {/* Mini-cards: Consumidor | Dados da Reclamação | Informações Gerais */}
            <RaMiniCards ticket={ticket} raContext={raContext} />

            {/* Description */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Descrição da Reclamação</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.description}</p>
              </CardContent>
            </Card>

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
                {/* RA action buttons inline — Solicitar Avaliação / Moderação / Encerrar Msg Privada */}
                <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-purple-100">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-200 text-purple-700 hover:bg-purple-50 transition-all duration-150 active:scale-95"
                    disabled={requestingEval || !ticket.raCanEvaluate}
                    onClick={handleRequestRaEvaluation}
                  >
                    {requestingEval ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />}
                    Solicitar Avaliação
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-200 text-purple-700 hover:bg-purple-50 transition-all duration-150 active:scale-95"
                    disabled={!ticket.raCanModerate}
                    onClick={() => dialogsRef.current?.openRaModeration()}
                  >
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    Solicitar Moderação
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-200 text-purple-700 hover:bg-purple-50 transition-all duration-150 active:scale-95"
                    disabled={finishingPrivate}
                    onClick={handleFinishPrivate}
                  >
                    {finishingPrivate ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="mr-1.5 h-3.5 w-3.5" />}
                    Encerrar Msg Privada
                  </Button>
                </div>
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
          <RaSidebar
            ticket={ticket}
            raContext={raContext}
            companyId={selectedCompanyId}
            users={users}
            financial={financial}
            onTicketUpdated={loadTicket}
            onOpenExportDialog={() => dialogsRef.current?.openExportDialog()}
          />
        </div>
      ) : (
        /* ═══════════════════════════════════════════════════════════
            GENERIC LAYOUT (EMAIL / WHATSAPP)
            ═══════════════════════════════════════════════════════════ */
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Mini-cards: Cliente | Dados | Informações */}
            <GenericMiniCards ticket={ticket} />

            {/* Description */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Descricao</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.description}</p>
              </CardContent>
            </Card>

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
          <TicketSidebar
            ticket={ticket}
            companyId={selectedCompanyId}
            users={users}
            financial={financial}
            refunds={refunds}
            cancellation={cancellation}
            userRole={userRole}
            onTicketUpdated={loadTicket}
            onOpenRequestRefund={() => dialogsRef.current?.openRequestRefund()}
            onOpenRejectRefund={(refundId) => dialogsRef.current?.openRejectRefund(refundId)}
            onOpenExecuteRefund={(refundId) => dialogsRef.current?.openExecuteRefund(refundId)}
            onOpenCancelDialog={() => dialogsRef.current?.openCancelDialog()}
            onOpenExportDialog={() => dialogsRef.current?.openExportDialog()}
            onRefundsChange={setRefunds}
            onCancellationChange={setCancellation}
          />
        </div>
      )}

      {/* ─── Dialogs (always rendered, used by both layouts) ──────── */}
      <TicketDialogs
        ref={dialogsRef}
        ticket={ticket}
        companyId={selectedCompanyId}
        refunds={refunds}
        onTicketUpdated={loadTicket}
        onRefundsChange={setRefunds}
        onCancellationChange={setCancellation}
      />
    </div>
  );
}
