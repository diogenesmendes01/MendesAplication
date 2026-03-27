"use client";

import { useRouter } from "next/navigation";
import { Mail, MessageSquare, Globe, Star, AlertTriangle, Bot, DollarSign, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TicketRow } from "../tickets/actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "agora";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  // Cap: if more than 365 days, show the date string instead
  if (diffD > 365) {
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  }
  return `há ${diffD}d`;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

function ChannelIcon({ type }: { type: string | null }) {
  if (type === "EMAIL") return <Mail className="h-3 w-3" />;
  if (type === "WHATSAPP") return <MessageSquare className="h-3 w-3" />;
  if (type === "RECLAMEAQUI") return <Star className="h-3 w-3" />;
  return <Globe className="h-3 w-3" />;
}

function channelLabel(type: string | null): string {
  if (type === "EMAIL") return "Email";
  if (type === "WHATSAPP") return "WhatsApp";
  if (type === "RECLAMEAQUI") return "Reclame Aqui";
  return "Web";
}

// ---------------------------------------------------------------------------
// TicketCard
// ---------------------------------------------------------------------------

interface TicketCardProps {
  row: TicketRow;
}

export function TicketCard({ row }: TicketCardProps) {
  const router = useRouter();

  const hasSlaBreached = row.slaStatus === "breached";
  const hasSlaRisk = row.slaStatus === "at_risk";
  const hasRefundPending = row.tags.includes("Reembolso");

  return (
    <div
      onClick={() => router.push(`/sac/tickets/${row.id}`)}
      className="
        cursor-pointer rounded-lg border bg-card p-3 shadow-sm
        transition-all duration-200
        hover:shadow-md hover:-translate-y-px
      "
    >
      {/* Header: ticket number + client */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-mono text-muted-foreground truncate">
            #{row.id.slice(-6).toUpperCase()} — {row.client.name}
          </p>
          <p className="mt-0.5 text-sm font-medium leading-tight line-clamp-2">
            {row.subject}
          </p>
        </div>
        {/* Assignee avatar */}
        {row.assignee && (
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold">
            {getInitials(row.assignee.name)}
          </div>
        )}
      </div>

      {/* Badges */}
      {(hasSlaBreached || hasSlaRisk || row.hasPendingSuggestion || hasRefundPending) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {hasSlaBreached && (
            <Badge
              variant="destructive"
              className="h-4 px-1 text-[10px] gap-0.5 font-medium"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              SLA
            </Badge>
          )}
          {hasSlaRisk && !hasSlaBreached && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[10px] gap-0.5 font-medium border-yellow-400 text-yellow-600 dark:text-yellow-400"
            >
              <Clock className="h-2.5 w-2.5" />
              Risco
            </Badge>
          )}
          {row.hasPendingSuggestion && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[10px] gap-0.5 font-medium border-blue-400 text-blue-600 dark:text-blue-400"
            >
              <Bot className="h-2.5 w-2.5" />
              IA
            </Badge>
          )}
          {hasRefundPending && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[10px] gap-0.5 font-medium border-orange-400 text-orange-600 dark:text-orange-400"
            >
              <DollarSign className="h-2.5 w-2.5" />
              Reemb
            </Badge>
          )}
        </div>
      )}

      {/* Footer: channel + relative time */}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ChannelIcon type={row.channelType} />
        <span>{channelLabel(row.channelType)}</span>
        <span className="ml-auto">{relativeTime(row.createdAt)}</span>
      </div>
    </div>
  );
}
