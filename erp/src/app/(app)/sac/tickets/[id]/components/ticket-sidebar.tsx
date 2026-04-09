"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  User,
  Calendar,
  Building2,
  FileText,
  CreditCard,
  Mail,
  MessageSquare,
  X,
  Plus,
  UserCircle,
  Clock,
  DollarSign,
  ExternalLink,
  Loader2,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  reassignTicket,
  addTag,
  removeTag,
  approveRefund,
  rejectRefund,
  getTicketRefunds,
  approveCancellation,
  getCancellationInfo,
  type TicketDetail,
  type ClientFinancialSummary,
  type RefundSummary,
  type CancellationInfo,
} from "../../actions";

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TicketSidebarProps {
  ticket: TicketDetail;
  companyId: string;
  users: { id: string; name: string }[];
  financial: ClientFinancialSummary | null;
  refunds: RefundSummary[];
  cancellation: CancellationInfo | null;
  userRole: string;
  onTicketUpdated: () => void;
  onOpenRequestRefund: () => void;
  onOpenRejectRefund: (refundId: string) => void;
  onOpenExecuteRefund: (refundId: string) => void;
  onOpenCancelDialog: () => void;
  onOpenExportDialog: () => void;
  onRefundsChange: (refunds: RefundSummary[]) => void;
  onCancellationChange: (cancellation: CancellationInfo | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TicketSidebar({
  ticket,
  companyId,
  users,
  financial,
  refunds,
  cancellation,
  userRole,
  onTicketUpdated,
  onOpenRequestRefund,
  onOpenRejectRefund,
  onOpenExecuteRefund,
  onOpenCancelDialog,
  onOpenExportDialog,
  onRefundsChange,
  onCancellationChange,
}: TicketSidebarProps) {
  const router = useRouter();

  // Sidebar-local state
  const [tags, setTags] = useState<string[]>(ticket.tags);
  const [newTag, setNewTag] = useState("");
  const [updatingAssignee, setUpdatingAssignee] = useState(false);
  const [approvingRefundId, setApprovingRefundId] = useState<string | null>(null);
  const [approvingCancel, setApprovingCancel] = useState(false);

  const isAdminOrManager = userRole === "ADMIN" || userRole === "MANAGER";
  const hasProposalOrBoleto = !!(ticket.proposalId || ticket.boletoId);
  const hasPendingCancellation = cancellation?.pending ?? false;

  // ---------------------------------------------------
  // Reassign
  // ---------------------------------------------------

  async function handleReassign(assigneeId: string) {
    setUpdatingAssignee(true);
    try {
      const result = await reassignTicket(ticket.id, companyId, assigneeId === "__none__" ? null : assigneeId);
      toast.success(result.assignee ? `Ticket reatribuído para ${result.assignee.name}` : "Responsável removido");
      onTicketUpdated();
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
    if (!newTag.trim()) return;
    try {
      const updatedTags = await addTag(ticket.id, companyId, newTag.trim());
      setTags(updatedTags);
      setNewTag("");
      toast.success("Tag adicionada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar tag");
    }
  }

  async function handleRemoveTag(tag: string) {
    try {
      const updatedTags = await removeTag(ticket.id, companyId, tag);
      setTags(updatedTags);
      toast.success("Tag removida");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover tag");
    }
  }

  // ---------------------------------------------------
  // Refund approve
  // ---------------------------------------------------

  async function handleApproveRefund(refundId: string) {
    setApprovingRefundId(refundId);
    try {
      await approveRefund(refundId, companyId);
      toast.success("Reembolso aprovado");
      getTicketRefunds(ticket.id, companyId).then(onRefundsChange).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar reembolso");
    } finally {
      setApprovingRefundId(null);
    }
  }

  // ---------------------------------------------------
  // Cancellation approve
  // ---------------------------------------------------

  async function handleApproveCancellation() {
    setApprovingCancel(true);
    try {
      await approveCancellation(ticket.id, companyId);
      toast.success("Cancelamento aprovado e executado");
      getCancellationInfo(ticket.id, companyId).then(onCancellationChange).catch(() => {});
      onTicketUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar cancelamento");
    } finally {
      setApprovingCancel(false);
    }
  }

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  return (
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
                  <Button size="sm" variant="outline" className="flex-1 border-red-300 text-red-700 hover:bg-red-50" onClick={() => onOpenRejectRefund(refund.id)}>
                    <XCircle className="mr-1 h-3 w-3" />
                    Rejeitar
                  </Button>
                </div>
              )}
              {refund.status === "APPROVED" && isAdminOrManager && (
                <Button size="sm" className="w-full" onClick={() => onOpenExecuteRefund(refund.id)}>
                  <Banknote className="mr-1.5 h-3.5 w-3.5" />
                  Executar Reembolso
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" className="w-full" onClick={onOpenRequestRefund}>
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
              <Button variant="outline" className="w-full border-red-200 text-red-700 hover:bg-red-50" onClick={onOpenCancelDialog}>
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
          <Button variant="outline" className="w-full" onClick={onOpenExportDialog}>
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Exportar PDF
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
