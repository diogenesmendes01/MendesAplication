"use client";

import {
  ArrowLeft,
  Globe,
  Sparkles,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChannelBadge } from "@/components/sac/channel-badge";
import {
  priorityLabel,
  priorityColor,
  statusLabel,
  statusColor,
} from "@/lib/sac/ticket-formatters";
import type { TicketDetail } from "../../actions";
import type { RaTicketContext } from "../../ra-actions.types";
import type { TicketStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFeelingEmoji(feeling: string | null): string {
  if (!feeling) return "";
  const f = feeling.toLowerCase();
  if (f.includes("irritado") || f.includes("raiva")) return "😡";
  if (f.includes("triste") || f.includes("decepcionado")) return "😢";
  if (f.includes("neutro")) return "😐";
  if (f.includes("satisfeito")) return "😊";
  return "💬";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TicketHeaderProps {
  ticket: TicketDetail;
  isRa: boolean;
  raContext: RaTicketContext | null;
  transitions: { value: TicketStatus; label: string }[];
  updatingStatus: boolean;
  onStatusChange: (status: TicketStatus) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TicketHeader({
  ticket,
  isRa,
  raContext,
  transitions,
  updatingStatus,
  onStatusChange,
  onBack,
}: TicketHeaderProps) {
  if (isRa) {
    return (
      <div className="rounded-xl border border-purple-200 bg-purple-50 px-5 py-4 space-y-3">
        {/* Top row: back + title + badges */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
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
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${priorityColor(ticket.priority)}`}
            >
              {priorityLabel(ticket.priority)}
            </span>
            {transitions.length > 0 ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                {transitions.map((t) => (
                  <Button
                    key={t.value}
                    size="sm"
                    variant="outline"
                    disabled={updatingStatus}
                    onClick={() => onStatusChange(t.value)}
                    className="transition-all duration-150 active:scale-95 hover:shadow-sm"
                  >
                    {updatingStatus && (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    {t.label}
                  </Button>
                ))}
              </div>
            ) : (
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${statusColor(ticket.status)}`}
              >
                {statusLabel(ticket.status)}
              </span>
            )}
            {ticket.raExternalId && (
              <a
                href={`https://www.reclameaqui.com.br/empresa/trustcloud/lista-reclamacoes/?problema=${ticket.raExternalId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-purple-700 hover:text-purple-900 font-mono bg-purple-50 border border-purple-200 rounded px-2 py-1"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                ID RA: {ticket.raExternalId}
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Generic header for non-RA tickets
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
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
      <div className="flex items-center gap-2 flex-wrap">
        <ChannelBadge channelType={ticket.channelType ?? null} />
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${priorityColor(ticket.priority)}`}
        >
          {priorityLabel(ticket.priority)}
        </span>
        {transitions.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {transitions.map((t) => (
              <Button
                key={t.value}
                size="sm"
                variant="outline"
                disabled={updatingStatus}
                onClick={() => onStatusChange(t.value)}
                className="transition-all duration-150 active:scale-95 hover:shadow-sm"
              >
                {updatingStatus && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                {t.label}
              </Button>
            ))}
          </div>
        ) : (
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${statusColor(ticket.status)}`}
          >
            {statusLabel(ticket.status)}
          </span>
        )}
      </div>
    </div>
  );
}
