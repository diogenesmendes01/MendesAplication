"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Mail,
  MessageSquare,
  Lock,
  Coins,
  Settings,
  Paperclip,
  Download,
  Bot,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TimelineEvent } from "../../actions";
import RaSuggestionCard from "../ra-suggestion-card";
import { retryFailedRaMessage } from "../../ra-actions";
import AiSuggestionCard from "./ai-suggestion-card";
import type { AiSuggestionData } from "./ai-suggestion-card";
import AiAuditPanel from "./ai-audit-panel";
import { WhatsAppBubble } from "./whatsapp-composer";
import { channelLabel, statusLabel } from "@/lib/sac/ticket-formatters";

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** Renders attachments with inline image thumbnails for images, download links for others */
function AttachmentList({ attachments }: { attachments: TimelineEvent["attachments"] }) {
  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => isImageMime(a.mimeType));
  const files = attachments.filter((a) => !isImageMime(a.mimeType));

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((att) => (
            <a
              key={att.id}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block max-w-[200px] rounded-md overflow-hidden border hover:border-primary transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.url}
                alt={att.fileName}
                className="max-h-[150px] w-auto object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <Download className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <span className="block px-1.5 py-0.5 text-[10px] text-muted-foreground truncate">
                {att.fileName}
              </span>
            </a>
          ))}
        </div>
      )}
      {files.map((att) => (
        <a
          key={att.id}
          href={att.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-primary hover:underline"
        >
          <Paperclip className="h-3 w-3" />
          <span>{att.fileName}</span>
          {att.fileSize > 0 && (
            <span className="text-muted-foreground">
              ({formatFileSize(att.fileSize)})
            </span>
          )}
          <Download className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

function originLabel(event: TimelineEvent): string | null {
  if (event.type === "status_change" || event.type === "refund") return null;
  if (event.origin === "SYSTEM") return "via ERP";
  if (event.origin === "EXTERNAL") {
    if (event.channel === "WHATSAPP") return "via WhatsApp Web";
    if (event.channel === "EMAIL") return "via Email Externo";
    return "via Externo";
  }
  if (event.sentViaEmail) return "via Email";
  return null;
}

function refundStatusLabel(s: string): string {
  switch (s) {
    case "AWAITING_APPROVAL":
      return "Aguardando Aprovacao";
    case "APPROVED":
      return "Aprovado";
    case "REJECTED":
      return "Rejeitado";
    case "PROCESSING":
      return "Processando";
    case "COMPLETED":
      return "Concluido";
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Event Icon
// ---------------------------------------------------------------------------

function EventIcon({ event }: { event: TimelineEvent }) {
  switch (event.type) {
    case "internal_note":
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
          <Lock className="h-4 w-4" />
        </div>
      );
    case "refund":
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700">
          <Coins className="h-4 w-4" />
        </div>
      );
    case "status_change":
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
          <Settings className="h-4 w-4" />
        </div>
      );
    default:
      if (event.channel === "EMAIL") {
        return (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <Mail className="h-4 w-4" />
          </div>
        );
      }
      if (event.channel === "WHATSAPP") {
        return (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            <MessageSquare className="h-4 w-4" />
          </div>
        );
      }
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MessageSquare className="h-4 w-4" />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Retry Failed Button
// ---------------------------------------------------------------------------

function RetryFailedButton({ messageId, companyId, onRetry }: { messageId: string; companyId: string; onRetry?: () => void }) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      const result = await retryFailedRaMessage(messageId, companyId);
      if (result.success) {
        toast.success("Mensagem reenviada para fila de envio");
        onRetry?.();
      } else {
        toast.error(result.error ?? "Erro ao reenviar mensagem");
      }
    } catch {
      toast.error("Erro ao reenviar mensagem");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mt-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleRetry}
        disabled={retrying}
        className="text-xs border-red-300 text-red-700 hover:bg-red-50"
      >
        <RefreshCw className={`mr-1 h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
        {retrying ? "Reenviando..." : "Tentar novamente"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Event Item
// ---------------------------------------------------------------------------

function TimelineItem({ event, channelType, companyId, ticketId, onActionComplete, isGrouped }: { event: TimelineEvent; channelType?: string | null; companyId: string; ticketId: string; onActionComplete?: () => void; isGrouped?: boolean }) {
  // AI-generated suggestion pending approval -> render SuggestionCard
  if (event.isAiGenerated && event.deliveryStatus === "PENDING_APPROVAL") {
    return (
      <div className="flex gap-3 rounded-lg p-1 -mx-1 hover:bg-muted/40 transition-colors duration-150">
        <EventIcon event={event} />
        <div className="flex-1 min-w-0">
          <RaSuggestionCard
            messageId={event.id}
            companyId={companyId}
            content={event.content}
            createdAt={event.createdAt}
            onActionComplete={onActionComplete}
          />
        </div>
      </div>
    );
  }

  // WhatsApp message in Todos tab -> bubble layout
  if (event.channel === "WHATSAPP" && event.type === "message" && !event.isAiGenerated) {
    return <WhatsAppBubble event={event} />;
  }

  // Email message in Todos tab -> compact email header
  if (event.channel === "EMAIL" && event.type === "message") {
    const isInbound = event.direction === "INBOUND";
    const senderName = isInbound
      ? event.contactName ?? "Remetente desconhecido"
      : event.sender?.name ?? "Atendente";
    return (
      <div className={`flex gap-3 ${isGrouped ? "pl-11 -mt-2" : ""} ${event.deliveryStatus === "DISCARDED" ? "opacity-50" : ""}`}>
        {!isGrouped && <EventIcon event={event} />}
        {isGrouped && <div className="w-8 shrink-0" />}
        <div className="flex-1 min-w-0 rounded-lg border bg-blue-50/40 p-3">
          {!isGrouped && (
            <div className="text-xs text-muted-foreground space-y-0.5 border-b border-blue-100 pb-2 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="font-medium w-10 shrink-0">De:</span>
                <span className="font-semibold text-foreground">{senderName}</span>
                {isInbound && (
                  <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">Recebido</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-medium w-10 shrink-0">Para:</span>
                <span>{isInbound ? "Suporte" : event.contactName ?? "Cliente"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-medium w-10 shrink-0">Data:</span>
                <span className="text-muted-foreground">{dateFmt.format(new Date(event.createdAt))}</span>
                {event.isAiGenerated && (
                  <span className="ml-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700">IA</span>
                )}
              </div>
            </div>
          )}
          {isGrouped && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">{dateFmt.format(new Date(event.createdAt))}</span>
            </div>
          )}
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {event.content}
          </p>
          <AttachmentList attachments={event.attachments} />
        </div>
      </div>
    );
  }

  const isDiscarded = event.deliveryStatus === "DISCARDED";
  const origin = originLabel(event);
  const isNote = event.type === "internal_note";

  return (
    <div className={`flex gap-3 ${isNote ? "rounded-lg bg-yellow-50 p-3" : ""} ${isDiscarded ? "opacity-50" : ""}`}>
      <EventIcon event={event} />
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          {event.sender && (
            <span className="text-sm font-semibold">{event.sender.name}</span>
          )}
          {event.contactName && (
            <span className="text-sm font-semibold">
              {event.contactName}
              {event.contactRole && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  ({event.contactRole})
                </span>
              )}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {dateFmt.format(new Date(event.createdAt))}
          </span>
          {event.type === "message" && event.channel && (
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {channelLabel(event.channel)}
            </Badge>
          )}
          {origin && (
            <span className="text-xs text-muted-foreground italic">
              {origin}
            </span>
          )}
          {isNote && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              <Lock className="mr-1 h-3 w-3" />
              Nota interna
            </Badge>
          )}
          {event.type === "message" && event.direction === "INBOUND" && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-green-300 text-green-700">
              Recebido
            </Badge>
          )}
          {event.isAiGenerated && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-purple-300 text-purple-700">
              <Bot className="mr-1 h-3 w-3" />
              IA
            </Badge>
          )}
          {channelType === "RECLAMEAQUI" && event.type === "message" && !event.isAiGenerated && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-orange-300 text-orange-700">
              {event.isInternal ? "📨 Privada" : "📢 Pública"}
            </Badge>
          )}
          {isDiscarded && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-gray-300 text-gray-500">
              Descartada
            </Badge>
          )}
          {event.deliveryStatus === "FAILED" && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Falha no envio
            </Badge>
          )}
        </div>

        {/* Retry button for FAILED messages */}
        {event.deliveryStatus === "FAILED" && event.channel === "RECLAMEAQUI" && event.direction === "OUTBOUND" && (
          <RetryFailedButton messageId={event.id} companyId={companyId} onRetry={onActionComplete} />
        )}

        {/* Content */}
        {event.type === "status_change" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Status alterado
            {event.oldStatus && (
              <> de <strong>{statusLabel(event.oldStatus)}</strong></>
            )}
            {event.newStatus && (
              <> para <strong>{statusLabel(event.newStatus)}</strong></>
            )}
          </p>
        ) : event.type === "refund" ? (
          <div className="mt-1">
            <p className="text-sm">{event.content}</p>
            {event.refundStatus && (
              <Badge
                variant={event.refundStatus === "COMPLETED" ? "default" : "secondary"}
                className="mt-1 text-xs"
              >
                {refundStatusLabel(event.refundStatus)}
              </Badge>
            )}
          </div>
        ) : (
          <p className={`mt-1 text-sm whitespace-pre-wrap leading-relaxed ${isDiscarded ? "line-through" : ""}`}>
            {event.content}
          </p>
        )}

        {/* Attachments */}
        <AttachmentList attachments={event.attachments} />

        {/* AI Audit Trail */}
        {event.isAiGenerated && companyId && (
          <AiAuditPanel ticketId={ticketId} companyId={companyId} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimelineEventList — the scrollable event list for the "Todos" tab
// ---------------------------------------------------------------------------

export interface TimelineEventListProps {
  events: TimelineEvent[];
  suggestions: AiSuggestionData[];
  loading: boolean;
  ticketId: string;
  companyId: string;
  channelType?: string | null;
  onSuggestionAction: () => void;
}

export function TimelineEventList({
  events,
  suggestions,
  loading,
  ticketId,
  companyId,
  channelType,
  onSuggestionAction,
}: TimelineEventListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="space-y-4 max-h-[500px] overflow-y-auto mb-6">
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Carregando timeline...
        </p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nenhum evento ainda.
        </p>
      ) : (
        (() => {
          // Merge events + pending suggestions sorted chronologically (Fix 2)
          const pendingSuggs = suggestions.filter(s => s.status === "PENDING");
          type TimelineEntry =
            | { kind: "event"; data: TimelineEvent; createdAt: string }
            | { kind: "suggestion"; data: AiSuggestionData; createdAt: string };

          const merged: TimelineEntry[] = [
            ...events.map((e): TimelineEntry => ({ kind: "event", data: e, createdAt: e.createdAt })),
            ...pendingSuggs.map((s): TimelineEntry => ({ kind: "suggestion", data: s, createdAt: s.createdAt })),
          ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

          return merged.map((entry, idx) => {
            if (entry.kind === "suggestion") {
              return (
                <AiSuggestionCard
                  key={`sugg-${entry.data.id}`}
                  suggestion={entry.data}
                  onActionComplete={onSuggestionAction}
                />
              );
            }

            const evt = entry.data;
            const prevEntry = merged[idx - 1];
            const prev = prevEntry?.kind === "event" ? prevEntry.data : null;
            const isGrouped =
              evt.channel === "EMAIL" &&
              evt.type === "message" &&
              prev !== null &&
              prev.channel === "EMAIL" &&
              prev.type === "message" &&
              (
                (evt.direction === "INBOUND" && prev.direction === "INBOUND" &&
                  evt.contactName === prev.contactName) ||
                (evt.direction === "OUTBOUND" && prev.direction === "OUTBOUND" &&
                  evt.sender?.id === prev.sender?.id)
              );
            return (
              <TimelineItem
                key={evt.id}
                event={evt}
                channelType={channelType}
                companyId={companyId}
                ticketId={ticketId}
                onActionComplete={onSuggestionAction}
                isGrouped={isGrouped}
              />
            );
          });
        })()
      )}
      <div ref={endRef} />
    </div>
  );
}
