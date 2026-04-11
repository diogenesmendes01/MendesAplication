"use client";

import { Loader2, ThumbsUp, ShieldCheck, MessageSquare } from "lucide-react";
import { useChannelTheme } from "./channel-theme-provider";
import { channelLabel } from "@/lib/sac/ticket-formatters";
import RaResponsePanel from "../ra-response-panel";

interface TicketComposerTabProps {
  ticket: {
    channelType: string | null;
    raCanEvaluate?: boolean;
    raCanModerate?: boolean;
  };
  ticketId: string;
  companyId: string;
  initialPublicMessage: string;
  // RA handlers
  onSendPublic: (msg: string) => Promise<void>;
  onSendPrivate: (msg: string, files: File[]) => Promise<void>;
  sendingPublic: boolean;
  sendingPrivate: boolean;
  requestingEval: boolean;
  finishingPrivate: boolean;
  onRequestEvaluation: () => void;
  onOpenModeration: () => void;
  onFinishPrivate: () => void;
}

export default function TicketComposerTab({
  ticket,
  ticketId,
  companyId,
  initialPublicMessage,
  onSendPublic,
  onSendPrivate,
  sendingPublic,
  sendingPrivate,
  requestingEval,
  finishingPrivate,
  onRequestEvaluation,
  onOpenModeration,
  onFinishPrivate,
}: TicketComposerTabProps) {
  const theme = useChannelTheme();
  const isRa = ticket.channelType === "RECLAMEAQUI";

  if (!isRa) {
    return (
      <div className="px-5 py-8 text-center text-[12px] text-[#94a3b8]">
        Use a aba <strong>Timeline</strong> para enviar mensagens por {channelLabel(ticket.channelType)}.
      </div>
    );
  }

  return (
    <div className="px-5 py-4 space-y-3">
      <RaResponsePanel
        ticketId={ticketId}
        companyId={companyId}
        initialPublicMessage={initialPublicMessage}
        onSendPublic={onSendPublic}
        onSendPrivate={(msg, files) => onSendPrivate(msg, files)}
        sendingPublic={sendingPublic}
        sendingPrivate={sendingPrivate}
      />

      {/* RA actions below composer */}
      <div
        className="flex items-center gap-[6px] flex-wrap pt-[10px]"
        style={{ borderTop: `1px solid ${theme.miniCardBorder}`, marginTop: "12px" }}
      >
        <button
          onClick={onRequestEvaluation}
          disabled={requestingEval || !ticket.raCanEvaluate}
          className="rounded-[5px] px-[10px] py-1 text-[10px] border bg-white hover:bg-[#F5F0FF] transition-colors disabled:opacity-50"
          style={{ borderColor: "#DDD6FE", color: "#7C3AED" }}
        >
          {requestingEval ? <Loader2 className="mr-1 inline h-[10px] w-[10px] animate-spin" /> : <ThumbsUp className="mr-1 inline h-[10px] w-[10px]" />}
          Solicitar Avaliacao
        </button>
        <button
          onClick={onOpenModeration}
          disabled={!ticket.raCanModerate}
          className="rounded-[5px] px-[10px] py-1 text-[10px] border bg-white hover:bg-[#F5F0FF] transition-colors disabled:opacity-50"
          style={{ borderColor: "#DDD6FE", color: "#7C3AED" }}
        >
          <ShieldCheck className="mr-1 inline h-[10px] w-[10px]" />
          Solicitar Moderacao
        </button>
        <button
          onClick={onFinishPrivate}
          disabled={finishingPrivate}
          className="rounded-[5px] px-[10px] py-1 text-[10px] border bg-white hover:bg-[#F5F0FF] transition-colors disabled:opacity-50"
          style={{ borderColor: "#DDD6FE", color: "#7C3AED" }}
        >
          {finishingPrivate ? <Loader2 className="mr-1 inline h-[10px] w-[10px] animate-spin" /> : <MessageSquare className="mr-1 inline h-[10px] w-[10px]" />}
          Encerrar Msg Privada
        </button>
      </div>
    </div>
  );
}
