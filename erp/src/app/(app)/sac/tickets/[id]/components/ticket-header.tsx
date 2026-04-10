// erp/src/app/(app)/sac/tickets/[id]/components/ticket-header.tsx
"use client";

import {
  ArrowLeft,
  ExternalLink,
  FileDown,
  Loader2,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  Ban,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useChannelTheme } from "./channel-theme-provider";
import {
  priorityLabel,
  priorityColor,
  statusLabel,
  statusColor,
  getFeelingEmoji,
} from "@/lib/sac/ticket-formatters";
import type { TicketStatus } from "@prisma/client";

// Status transitions map — source of truth
export const STATUS_TRANSITIONS: Record<string, { value: TicketStatus; label: string }[]> = {
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

interface TicketHeaderProps {
  ticket: {
    id: string;
    subject: string;
    status: string;
    priority: string;
    channelType: string | null;
    aiEnabled: boolean;
    raExternalId?: string | null;
    raStatusName?: string | null;
    raRating?: string | number | null;
    raCanEvaluate?: boolean;
    raCanModerate?: boolean;
  };
  raContext: {
    raFeeling?: string | null;
    raResolvedIssue?: boolean | null;
    raBackDoingBusiness?: boolean | null;
    raCategories?: string[];
    raFrozen?: boolean;
  } | null;
  updatingStatus: boolean;
  onStatusChange: (status: TicketStatus) => void;
  onExport: () => void;
  onRequestEvaluation?: () => void;
  requestingEval?: boolean;
  onOpenModeration?: () => void;
  onCancelDialog?: () => void;
  hasProposalOrBoleto?: boolean;
}

export default function TicketHeader({
  ticket,
  raContext,
  updatingStatus,
  onStatusChange,
  onExport,
  onRequestEvaluation,
  requestingEval,
  onOpenModeration,
  onCancelDialog,
  hasProposalOrBoleto,
}: TicketHeaderProps) {
  const router = useRouter();
  const theme = useChannelTheme();
  const isRa = ticket.channelType === "RECLAMEAQUI";
  const transitions = STATUS_TRANSITIONS[ticket.status] ?? [];

  return (
    <div
      className="rounded-xl border px-5 py-[14px] pb-[10px]"
      style={{
        background: theme.headerBg,
        borderColor: theme.headerBorder,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: back + title */}
        <div className="flex items-start gap-5">
          <button
            onClick={() => router.push("/sac/tickets")}
            className="mt-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] border bg-white/70 hover:bg-white/90 transition-all"
            style={{ borderColor: "rgba(0,0,0,0.08)" }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div>
            {/* Title row */}
            <h1
              className="text-[20px] font-bold leading-[1.3]"
              style={{ color: theme.titleColor }}
            >
              {ticket.subject}
              <span className="ml-2 text-[10px] font-normal font-mono text-[#94a3b8]">
                #{ticket.id.slice(-8)}
              </span>
              <span className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${priorityColor(ticket.priority)}`}>
                {priorityLabel(ticket.priority)}
              </span>
            </h1>

            {/* RA extras: badges row */}
            {isRa && (
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                {ticket.aiEnabled && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-[7px] py-[2px] text-[9px]"
                    style={{ background: "#F3E8FF", color: "#7C3AED" }}
                  >
                    <Sparkles className="h-[10px] w-[10px]" />
                    IA ativa
                  </span>
                )}
                {ticket.raExternalId && (
                  <a
                    href={`https://www.reclameaqui.com.br/empresa/trustcloud/lista-reclamacoes/?problema=${ticket.raExternalId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono rounded px-[7px] py-[2px] text-[9px]"
                    style={{ background: "#F5F0FF", border: "1px solid #E8DAFF", color: "#7C3AED" }}
                  >
                    <ExternalLink className="h-[10px] w-[10px]" />
                    ID RA: {ticket.raExternalId}
                  </a>
                )}
                {raContext?.raFeeling && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-[7px] py-[2px] text-[9px]"
                    style={{ background: "white", border: "1px solid #E8DAFF", color: "#6D28D9" }}
                  >
                    {getFeelingEmoji(raContext.raFeeling)} {raContext.raFeeling}
                  </span>
                )}
              </div>
            )}

            {/* RA Status Pills */}
            {isRa && (
              <div className="mt-[15px] flex items-center gap-1 flex-wrap">
                {ticket.raStatusName && (
                  <span className="inline-flex items-center gap-1 rounded px-[7px] py-[2px] text-[10px]"
                    style={{ background: "#F5F0FF", border: "1px solid #E8DAFF" }}
                  >
                    <span style={{ color: "#A78BFA" }}>Status RA:</span>
                    <span className="font-semibold">{ticket.raStatusName}</span>
                  </span>
                )}
                {ticket.raRating != null && (
                  <span className="inline-flex items-center gap-1 rounded px-[7px] py-[2px] text-[10px]"
                    style={{ background: "#F5F0FF", border: "1px solid #E8DAFF" }}
                  >
                    <span style={{ color: "#A78BFA" }}>Avaliacao:</span>
                    <span className="font-semibold">{ticket.raRating}/10</span>
                  </span>
                )}
                {raContext?.raResolvedIssue != null && (
                  <span className="inline-flex items-center gap-1 rounded px-[7px] py-[2px] text-[10px]"
                    style={{ background: "#F5F0FF", border: "1px solid #E8DAFF" }}
                  >
                    <span style={{ color: "#A78BFA" }}>Resolvido:</span>
                    <span className="font-semibold" style={{ color: raContext.raResolvedIssue ? "#059669" : "#DC2626" }}>
                      {raContext.raResolvedIssue ? "Sim" : "Nao"}
                    </span>
                  </span>
                )}
                {raContext?.raBackDoingBusiness != null && (
                  <span className="inline-flex items-center gap-1 rounded px-[7px] py-[2px] text-[10px]"
                    style={{ background: "#F5F0FF", border: "1px solid #E8DAFF" }}
                  >
                    <span style={{ color: "#A78BFA" }}>Voltaria:</span>
                    <span className="font-semibold" style={{ color: raContext.raBackDoingBusiness ? "#059669" : "#DC2626" }}>
                      {raContext.raBackDoingBusiness ? "Sim" : "Nao"}
                    </span>
                  </span>
                )}
                {raContext?.raFrozen && (
                  <span className="inline-flex items-center rounded px-[7px] py-[2px] text-[10px] font-semibold"
                    style={{ background: "#FEE2E2", border: "1px solid #FECACA", color: "#991B1B" }}
                  >
                    Congelado
                  </span>
                )}
              </div>
            )}

            {/* RA Categories */}
            {isRa && raContext?.raCategories && raContext.raCategories.length > 0 && (
              <div className="mt-1 flex items-center gap-[3px] flex-wrap">
                {raContext.raCategories.map((cat: string, i: number) => (
                  <span key={i} className="rounded-[3px] px-[6px] py-[1px] text-[9px]"
                    style={{ background: "#F3E8FF", color: "#7C3AED" }}
                  >
                    {cat}
                  </span>
                ))}
              </div>
            )}

            {/* Non-RA: status badge row */}
            {!isRa && (
              <div className="mt-[15px] flex items-center gap-2">
                {transitions.length > 0 ? (
                  transitions.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => onStatusChange(t.value)}
                      disabled={updatingStatus}
                      className="rounded-[5px] px-2 py-1 text-[10px] border bg-white hover:-translate-y-[0.5px] hover:shadow-sm transition-all"
                      style={{ borderColor: theme.btnOutlineBorder, color: theme.btnOutlineColor }}
                    >
                      {updatingStatus && <Loader2 className="mr-1 inline h-[11px] w-[11px] animate-spin" />}
                      {t.label}
                    </button>
                  ))
                ) : (
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusColor(ticket.status)}`}>
                    {statusLabel(ticket.status)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-start gap-[3px] flex-wrap">
          {/* Status transitions (RA only — shown in header) */}
          {isRa && transitions.length > 0 && transitions.map((t) => (
            <button
              key={t.value}
              onClick={() => onStatusChange(t.value)}
              disabled={updatingStatus}
              className="rounded-[5px] px-2 py-1 text-[10px] border bg-white hover:-translate-y-[0.5px] hover:shadow-sm transition-all"
              style={{ borderColor: theme.btnOutlineBorder, color: theme.btnOutlineColor }}
            >
              {updatingStatus && <Loader2 className="mr-1 inline h-[11px] w-[11px] animate-spin" />}
              {t.label}
            </button>
          ))}

          {isRa && transitions.length === 0 && (
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusColor(ticket.status)}`}>
              {statusLabel(ticket.status)}
            </span>
          )}

          {/* Export */}
          <button
            onClick={onExport}
            className="rounded-[5px] px-2 py-1 text-[10px] border bg-white hover:-translate-y-[0.5px] hover:shadow-sm transition-all"
            style={{ borderColor: theme.btnOutlineBorder, color: theme.btnOutlineColor }}
          >
            <FileDown className="mr-1 inline h-[11px] w-[11px]" />
            Exportar
          </button>

          {/* RA-specific: Avaliacao + Moderacao */}
          {isRa && onRequestEvaluation && (
            <button
              onClick={onRequestEvaluation}
              disabled={requestingEval || !ticket.raCanEvaluate}
              className="rounded-[5px] px-2 py-1 text-[10px] border bg-white hover:-translate-y-[0.5px] hover:shadow-sm transition-all disabled:opacity-50"
              style={{ borderColor: theme.btnOutlineBorder, color: theme.btnOutlineColor }}
            >
              {requestingEval ? <Loader2 className="mr-1 inline h-[11px] w-[11px] animate-spin" /> : <ThumbsUp className="mr-1 inline h-[11px] w-[11px]" />}
              Avaliacao
            </button>
          )}

          {isRa && onOpenModeration && (
            <button
              onClick={onOpenModeration}
              disabled={!ticket.raCanModerate}
              className="rounded-[5px] px-2 py-1 text-[10px] border bg-white hover:-translate-y-[0.5px] hover:shadow-sm transition-all disabled:opacity-50"
              style={{ borderColor: theme.btnOutlineBorder, color: theme.btnOutlineColor }}
            >
              <ShieldCheck className="mr-1 inline h-[11px] w-[11px]" />
              Moderacao
            </button>
          )}

          {/* Non-RA: Cancel button */}
          {!isRa && hasProposalOrBoleto && onCancelDialog && (
            <button
              onClick={onCancelDialog}
              className="rounded-[5px] px-2 py-1 text-[10px] border bg-white hover:-translate-y-[0.5px] hover:shadow-sm transition-all"
              style={{ borderColor: "#FECACA", color: "#DC2626" }}
            >
              <Ban className="mr-1 inline h-[11px] w-[11px]" />
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
