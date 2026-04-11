"use client";

import {
  Plus,
  X,
  ExternalLink,
  Coins,
  Ban,
  FileDown,
  CheckCircle,
  XCircle,
  Banknote,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateFmt, formatCurrency } from "@/lib/sac/ticket-formatters";
import type { ClientFinancialSummary, RefundSummary, CancellationInfo } from "../../actions";

interface TicketSidebarProps {
  ticket: {
    channelType: string | null;
    proposalId?: string | null;
    boletoId?: string | null;
    assignee?: { id: string; name: string } | null;
  };
  // Assignee
  users: { id: string; name: string }[];
  updatingAssignee: boolean;
  onReassign: (userId: string) => void;
  // Tags
  tags: string[];
  newTag: string;
  onNewTagChange: (val: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  // Financial
  financial: ClientFinancialSummary | null;
  // Refund (WA-only)
  refunds: RefundSummary[];
  isAdminOrManager: boolean;
  approvingRefundId: string | null;
  onApproveRefund: (id: string) => void;
  onOpenRejectRefund: (id: string) => void;
  onOpenExecuteRefund: (id: string) => void;
  onRequestRefund: () => void;
  // Cancellation (all channels)
  cancellation: CancellationInfo | null;
  hasPendingCancellation: boolean;
  hasProposalOrBoleto: boolean;
  approvingCancel: boolean;
  onApproveCancellation: () => void;
  onOpenCancelDialog: () => void;
  // Export
  onExport: () => void;
}

export default function TicketSidebar({
  ticket,
  users,
  updatingAssignee,
  onReassign,
  tags,
  newTag,
  onNewTagChange,
  onAddTag,
  onRemoveTag,
  financial,
  refunds,
  isAdminOrManager,
  approvingRefundId,
  onApproveRefund,
  onOpenRejectRefund,
  onOpenExecuteRefund,
  onRequestRefund,
  cancellation,
  hasPendingCancellation,
  hasProposalOrBoleto,
  approvingCancel,
  onApproveCancellation,
  onOpenCancelDialog,
  onExport,
}: TicketSidebarProps) {
  const router = useRouter();

  return (
    <div className="space-y-4 border-l border-[#f1f5f9] p-4 bg-[#FCFCFA]">
      {/* Responsavel */}
      <div>
        <h3 className="text-[9px] uppercase tracking-[0.05em] font-bold text-[#94a3b8] mb-2">Responsavel</h3>
        <Select value={ticket.assignee?.id ?? "__none__"} onValueChange={onReassign} disabled={updatingAssignee}>
          <SelectTrigger className="h-8 text-[11px]">
            <SelectValue placeholder="Selecione..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Nenhum</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tags */}
      <div>
        <h3 className="text-[9px] uppercase tracking-[0.05em] font-bold text-[#94a3b8] mb-2">Tags</h3>
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.length === 0 && <p className="text-[10px] text-[#94a3b8]">Nenhuma tag</p>}
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded px-[7px] py-[2px] text-[10px] bg-[#f1f5f9] text-[#475569]">
              {tag}
              <button type="button" onClick={() => onRemoveTag(tag)} className="text-[8px] hover:text-red-500">
                <X className="h-[10px] w-[10px]" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <Input
            placeholder="Nova tag..."
            value={newTag}
            onChange={(e) => onNewTagChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAddTag(); } }}
            className="h-7 text-[10px]"
          />
          <Button size="sm" variant="outline" onClick={onAddTag} disabled={!newTag.trim()} className="h-7 px-2">
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Financeiro */}
      {financial && (
        <div className="rounded-[7px] border border-[#e2e8f0] p-[10px] space-y-2">
          <h3 className="text-[9px] uppercase tracking-[0.05em] font-bold text-[#94a3b8]">Financeiro</h3>
          <Badge
            className={`text-[9px] ${
              financial.status === "adimplente"
                ? "bg-[#ECFDF5] text-[#059669] hover:bg-[#ECFDF5]"
                : financial.status === "atraso"
                  ? "bg-[#FEF3C7] text-[#92400E] hover:bg-[#FEF3C7]"
                  : "bg-[#FEE2E2] text-[#991B1B] hover:bg-[#FEE2E2]"
            }`}
          >
            {financial.status === "adimplente" ? "Adimplente" : financial.status === "atraso" ? "Em Atraso" : "Inadimplente"}
          </Badge>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] text-[#94a3b8]">Pendente</p>
              <p className="text-[12px] font-semibold">R$ {formatCurrency(financial.pendingTotal)}</p>
            </div>
            <div>
              <p className="text-[9px] text-[#94a3b8]">Vencido</p>
              <p className="text-[12px] font-semibold" style={{ color: financial.overdueTotal > 0 ? "#DC2626" : undefined }}>
                R$ {formatCurrency(financial.overdueTotal)}
              </p>
            </div>
          </div>
          {financial.lastPayment && (
            <div className="border-t border-[#f1f5f9] pt-2">
              <p className="text-[9px] text-[#94a3b8]">Ultimo Pagamento</p>
              <p className="text-[10px]">{dateFmt.format(new Date(financial.lastPayment))}</p>
            </div>
          )}
          <button
            onClick={() => router.push("/financeiro/receber")}
            className="flex items-center gap-1 text-[9px] text-[#2563EB] hover:underline mt-1"
          >
            <ExternalLink className="h-[10px] w-[10px]" />
            Ver financeiro
          </button>
        </div>
      )}

      {/* Reembolso (non-RA only — RA uses RaSidebar which has no refund flow) */}
      {ticket.channelType !== "RECLAMEAQUI" && (
      <div className="space-y-2">
          <h3 className="text-[9px] uppercase tracking-[0.05em] font-bold text-[#94a3b8]">Reembolso</h3>
          {refunds.length === 0 && <p className="text-[10px] text-[#94a3b8]">Nenhum reembolso</p>}
          {refunds.map((refund) => (
            <div key={refund.id} className="rounded-[7px] border border-[#e2e8f0] p-[10px] space-y-2">
              <div className="flex items-center justify-between">
                <Badge className={`text-[9px] ${
                  refund.status === "COMPLETED" ? "bg-[#ECFDF5] text-[#059669]" :
                  refund.status === "APPROVED" ? "bg-[#DBEAFE] text-[#1D4ED8]" :
                  refund.status === "AWAITING_APPROVAL" ? "bg-[#FEF3C7] text-[#92400E]" :
                  refund.status === "REJECTED" ? "bg-destructive text-destructive-foreground" : ""
                }`}>
                  {refund.status === "AWAITING_APPROVAL" ? "Aguardando Aprovacao" :
                   refund.status === "APPROVED" ? "Aprovado" :
                   refund.status === "REJECTED" ? "Rejeitado" :
                   refund.status === "PROCESSING" ? "Processando" : "Concluido"}
                </Badge>
                <span className="text-[12px] font-bold">R$ {formatCurrency(refund.amount)}</span>
              </div>
              <div className="text-[9px] text-[#94a3b8] space-y-0.5">
                <p>Solicitante: {refund.requestedBy.name}</p>
                <p>Data: {dateFmt.format(new Date(refund.requestedAt))}</p>
                {refund.approvedBy && <p>{refund.status === "REJECTED" ? "Rejeitado" : "Aprovado"} por: {refund.approvedBy.name}</p>}
                {refund.rejectionReason && <p className="text-red-600">Motivo: {refund.rejectionReason}</p>}
                {refund.paymentMethod && <p>Metodo: {refund.paymentMethod}</p>}
              </div>
              {refund.slaDeadline && !["COMPLETED", "REJECTED"].includes(refund.status) && (
                <div className="text-[9px]">
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
                <div className="flex gap-1 pt-1">
                  <Button size="sm" variant="outline" className="flex-1 h-7 text-[10px] border-green-300 text-green-700 hover:bg-green-50" disabled={approvingRefundId === refund.id} onClick={() => onApproveRefund(refund.id)}>
                    {approvingRefundId === refund.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
                    Aprovar
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-7 text-[10px] border-red-300 text-red-700 hover:bg-red-50" onClick={() => onOpenRejectRefund(refund.id)}>
                    <XCircle className="mr-1 h-3 w-3" />
                    Rejeitar
                  </Button>
                </div>
              )}
              {refund.status === "APPROVED" && isAdminOrManager && (
                <Button size="sm" className="w-full h-7 text-[10px]" onClick={() => onOpenExecuteRefund(refund.id)}>
                  <Banknote className="mr-1 h-3 w-3" />
                  Executar Reembolso
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" className="w-full h-8 text-[10px] border-[#e2e8f0]" onClick={onRequestRefund}>
            <Coins className="mr-1.5 h-3.5 w-3.5" />
            Solicitar Reembolso
          </Button>
      </div>
      )}

      {/* Cancelamento (all channels) */}
      {hasProposalOrBoleto && (
        <div className="space-y-2">
          <h3 className="text-[9px] uppercase tracking-[0.05em] font-bold text-[#94a3b8]">Cancelamento</h3>
          {hasPendingCancellation && cancellation && (
            <div className="rounded-[7px] border border-[#FDE68A] bg-[#FFFBEB] p-[10px] space-y-2">
              <Badge className="text-[9px] bg-[#FEF3C7] text-[#92400E] hover:bg-[#FEF3C7]">Aguardando Aprovacao</Badge>
              <div className="text-[9px] text-[#92400E] space-y-0.5">
                {cancellation.type && <p>Tipo: {cancellation.type === "proposal" ? "Proposta" : cancellation.type === "boletos" ? "Boletos" : "Proposta e Boletos"}</p>}
                {cancellation.requestedBy && <p>Solicitante: {cancellation.requestedBy}</p>}
                {cancellation.requestedAt && <p>Data: {dateFmt.format(new Date(cancellation.requestedAt))}</p>}
                {cancellation.justification && <p>Justificativa: {cancellation.justification}</p>}
              </div>
              {isAdminOrManager && (
                <Button size="sm" variant="outline" className="w-full h-7 text-[10px] border-green-300 text-green-700 hover:bg-green-50" disabled={approvingCancel} onClick={onApproveCancellation}>
                  {approvingCancel ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
                  Aprovar Cancelamento
                </Button>
              )}
            </div>
          )}
          {!hasPendingCancellation && (
            <Button variant="outline" className="w-full h-8 text-[10px] border-[#FECACA] text-[#DC2626] hover:bg-red-50" onClick={onOpenCancelDialog}>
              <Ban className="mr-1.5 h-3.5 w-3.5" />
              Solicitar Cancelamento
            </Button>
          )}
        </div>
      )}

      {/* Export */}
      <div>
        <Button variant="outline" className="w-full h-8 text-[10px]" onClick={onExport}>
          <FileDown className="mr-1.5 h-3.5 w-3.5" />
          Exportar PDF
        </Button>
      </div>
    </div>
  );
}
