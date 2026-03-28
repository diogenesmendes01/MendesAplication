"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Mail,
  MessageSquare,
  Lock,
  Coins,
  Settings,
  Paperclip,
  Download,
  Send,
  Upload,
  Smile,
  Bot,
  Wifi,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import Link from "next/link";
import {
  listTimelineEvents,
  createInternalNote,
  createTicketReply,
  attachFileToTicket,
  getEmailRecipients,
  sendEmailReply,
  getWhatsAppRecipients,
  sendWhatsAppMessage,
  toggleTicketAi,
  type TimelineEvent,
  type EmailRecipient,
  type WhatsAppRecipient,
  type AttachmentData,
} from "../actions";
import { getWhatsAppStatus } from "../../../configuracoes/canais/actions";
import { useEventStream } from "@/hooks/use-event-stream";
import RaSuggestionCard from "./ra-suggestion-card";
import AiSuggestionCard from "./components/ai-suggestion-card";
import type { AiSuggestionData } from "./components/ai-suggestion-card";
import { getSuggestions } from "./suggestion-actions";
import type { SuggestionRecord } from "./suggestion-actions";

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

function channelLabel(channel: string | null): string {
  switch (channel) {
    case "EMAIL":
      return "Email";
    case "WHATSAPP":
      return "WhatsApp";
    default:
      return "Web";
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "OPEN":
      return "Aberto";
    case "IN_PROGRESS":
      return "Em Andamento";
    case "WAITING_CLIENT":
      return "Aguardando Cliente";
    case "RESOLVED":
      return "Resolvido";
    case "CLOSED":
      return "Fechado";
    default:
      return s;
  }
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
// Timeline Event Item (Todos tab)
// ---------------------------------------------------------------------------

function TimelineItem({ event, channelType, companyId, onActionComplete, isGrouped }: { event: TimelineEvent; channelType?: string | null; companyId: string; onActionComplete?: () => void; isGrouped?: boolean }) {
  // AI-generated suggestion pending approval → render SuggestionCard
  if (event.isAiGenerated && event.deliveryStatus === "PENDING_APPROVAL") {
    return (
      <div className="flex gap-3">
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

  // WhatsApp message in Todos tab → bubble layout
  if (event.channel === "WHATSAPP" && event.type === "message" && !event.isAiGenerated) {
    return <WhatsAppBubble event={event} />;
  }

  // Email message in Todos tab → compact email header
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
        </div>

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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Email Thread Item
// ---------------------------------------------------------------------------

interface EmailThreadItemProps {
  event: TimelineEvent;
  ticketSubject: string;
}

function EmailThreadItem({ event, ticketSubject }: EmailThreadItemProps) {
  const origin = originLabel(event);
  const isInbound = event.direction === "INBOUND";
  const senderName = isInbound
    ? event.contactName ?? "Remetente desconhecido"
    : event.sender?.name ?? "Atendente";
  const senderRole = isInbound ? event.contactRole : null;

  return (
    <div className="rounded-lg border bg-card p-4">
      {/* Email header */}
      <div className="space-y-1 text-sm border-b pb-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium w-16 shrink-0">De:</span>
          <span className="font-semibold">
            {senderName}
            {senderRole && (
              <span className="font-normal text-muted-foreground"> ({senderRole})</span>
            )}
          </span>
          {isInbound && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-green-300 text-green-700">
              Recebido
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium w-16 shrink-0">Para:</span>
          <span>
            {isInbound ? "Suporte" : event.contactName ?? "Cliente"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium w-16 shrink-0">Assunto:</span>
          <span>Re: {ticketSubject}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium w-16 shrink-0">Data:</span>
          <span className="text-muted-foreground">
            {dateFmt.format(new Date(event.createdAt))}
          </span>
          {origin && (
            <span className="text-xs text-muted-foreground italic ml-2">
              {origin}
            </span>
          )}
        </div>
      </div>

      {/* Email body */}
      <p className="text-sm whitespace-pre-wrap leading-relaxed">
        {event.content}
      </p>

      {/* Attachments */}
      {event.attachments.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">Anexos:</span>
          <AttachmentList attachments={event.attachments} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp Chat Bubble
// ---------------------------------------------------------------------------

function WhatsAppBubble({ event }: { event: TimelineEvent }) {
  const isOutbound = event.direction === "OUTBOUND";
  const origin = originLabel(event);
  const senderName = isOutbound
    ? event.sender?.name ?? "Atendente"
    : event.contactName ?? "Contato";
  const senderRole = isOutbound ? null : event.contactRole;

  return (
    <div
      className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isOutbound
            ? "rounded-br-md bg-white border text-foreground shadow-sm"
            : "rounded-bl-md bg-green-50 text-green-900"
        }`}
      >
        {/* Sender */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold">
            {senderName}
            {senderRole && (
              <span className="font-normal text-muted-foreground">
                {" "}({senderRole})
              </span>
            )}
          </span>
          {origin && (
            <span className="text-[10px] text-muted-foreground italic">
              {origin}
            </span>
          )}
          {event.isAiGenerated && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 border-purple-300 text-purple-700">
              <Bot className="mr-0.5 h-2.5 w-2.5" />
              IA
            </Badge>
          )}
        </div>

        {/* Content */}
        <p className="text-sm whitespace-pre-wrap leading-relaxed">
          {event.content}
        </p>

        {/* Attachments */}
        <AttachmentList attachments={event.attachments} />

        {/* Timestamp + delivery status */}
        <div className="flex justify-end items-center gap-1 mt-1">
          <span className="text-[10px] text-muted-foreground">
            {dateFmt.format(new Date(event.createdAt))}
          </span>
          {isOutbound && event.deliveryStatus && event.deliveryStatus !== "DISCARDED" && (
            <span className="text-[10px] text-muted-foreground" title={event.deliveryStatus}>
              {event.deliveryStatus === "SENT" ? "✓" :
               event.deliveryStatus === "DELIVERED" ? "✓✓" :
               event.deliveryStatus === "READ" ? (
                <span className="text-blue-500">✓✓</span>
               ) : null}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emoji Picker (simple inline)
// ---------------------------------------------------------------------------

const COMMON_EMOJIS = [
  "\u{1F600}", "\u{1F601}", "\u{1F602}", "\u{1F603}", "\u{1F604}", "\u{1F605}", "\u{1F609}", "\u{1F60A}",
  "\u{1F60D}", "\u{1F618}", "\u{1F60E}", "\u{1F914}", "\u{1F44D}", "\u{1F44E}", "\u{1F44B}", "\u{1F64F}",
  "\u{1F389}", "\u{1F525}", "\u{2705}", "\u{274C}", "\u{26A0}\u{FE0F}", "\u{2764}\u{FE0F}", "\u{1F4E7}", "\u{1F4DE}",
  "\u{1F4CB}", "\u{1F4B0}", "\u{23F0}", "\u{1F504}", "\u{1F4AC}", "\u{270F}\u{FE0F}", "\u{1F50D}", "\u{1F6A8}",
];

function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="grid grid-cols-8 gap-1">
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded hover:bg-accent text-lg"
              onClick={() => onSelect(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface TicketTimelineProps {
  ticketId: string;
  companyId: string;
  ticketSubject: string;
  aiEnabled: boolean;
  aiConfigEnabled: boolean;
  channelType?: string | null;
}

export default function TicketTimeline({
  ticketId,
  companyId,
  ticketSubject,
  aiEnabled: initialAiEnabled,
  aiConfigEnabled,
  channelType,
}: TicketTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [suggestions, setSuggestions] = useState<AiSuggestionData[]>([]);
  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled);
  const [togglingAi, setTogglingAi] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [isInternalNote, setIsInternalNote] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  // Email tab state
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState(`Re: ${ticketSubject}`);
  const [emailContent, setEmailContent] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailUploading, setEmailUploading] = useState(false);
  const [emailAttachments, setEmailAttachments] = useState<
    (AttachmentData & { fileName: string })[]
  >([]);
  const emailFileInputRef = useRef<HTMLInputElement>(null);
  const emailEndRef = useRef<HTMLDivElement>(null);

  // WhatsApp tab state
  const [waRecipients, setWaRecipients] = useState<WhatsAppRecipient[]>([]);
  const [waTo, setWaTo] = useState("");
  const [waContent, setWaContent] = useState("");
  const [sendingWa, setSendingWa] = useState(false);
  const [waUploading, setWaUploading] = useState(false);
  const [waAttachments, setWaAttachments] = useState<
    (AttachmentData & { fileName: string })[]
  >([]);
  const waFileInputRef = useRef<HTMLInputElement>(null);
  const waEndRef = useRef<HTMLDivElement>(null);

  // WhatsApp connection status
  const [waConnected, setWaConnected] = useState<boolean | null>(null);

  // Track latest event timestamp for incremental polling
  const lastEventTimeRef = useRef<string | null>(null);

  // Active tab — controlled for lazy-loading recipients
  const [activeTab, setActiveTab] = useState("todos");

  const loadSuggestions = useCallback(async () => {
    if (!ticketId || !companyId) return;
    try {
      const data: SuggestionRecord[] = await getSuggestions(ticketId, companyId);
      setSuggestions(data.map((s): AiSuggestionData => ({
        id: s.id,
        ticketId: s.ticketId,
        companyId: s.companyId,
        channel: s.channel,
        analysis: (s.analysis || {}) as AiSuggestionData["analysis"],
        suggestedResponse: s.suggestedResponse,
        suggestedSubject: s.suggestedSubject ?? null,
        suggestedActions: (s.suggestedActions || []) as AiSuggestionData["suggestedActions"],
        raPrivateMessage: s.raPrivateMessage ?? null,
        raPublicMessage: s.raPublicMessage ?? null,
        raDetectedType: s.raDetectedType ?? null,
        raSuggestModeration: s.raSuggestModeration ?? false,
        status: s.status as AiSuggestionData["status"],
        reviewedBy: s.reviewedBy ?? null,
        reviewedAt: s.reviewedAt ?? null,
        editedResponse: s.editedResponse ?? null,
        editedSubject: s.editedSubject ?? null,
        rejectionReason: s.rejectionReason ?? null,
        confidence: s.confidence,
        createdAt: s.createdAt,
        reviewer: s.reviewer ?? null,
      })));
    } catch {
      // silent
    }
  }, [ticketId, companyId]);

  const loadEvents = useCallback(async () => {
    if (!ticketId || !companyId) return;
    setLoading(true);
    try {
      const data = await listTimelineEvents(ticketId, companyId, undefined, 50);
      setEvents(data);
      // Record latest event timestamp for incremental polling
      if (data.length > 0) {
        const latest = data.reduce(
          (max, e) => (e.createdAt > max ? e.createdAt : max),
          data[0].createdAt
        );
        lastEventTimeRef.current = latest;
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [ticketId, companyId]);

  useEffect(() => {
    loadEvents();
    loadSuggestions();
  }, [loadEvents, loadSuggestions]);

  // Incremental poll — only fetch events newer than the last known timestamp
  const pollNewEvents = useCallback(async () => {
    if (!ticketId || !companyId || !lastEventTimeRef.current) return;
    try {
      const newEvents = await listTimelineEvents(
        ticketId,
        companyId,
        lastEventTimeRef.current
      );
      if (newEvents.length > 0) {
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const unique = newEvents.filter((e) => !existingIds.has(e.id));
          if (unique.length === 0) return prev;
          const merged = [...prev, ...unique].sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          return merged;
        });
        const latest = newEvents.reduce(
          (max, e) => (e.createdAt > max ? e.createdAt : max),
          newEvents[0].createdAt
        );
        lastEventTimeRef.current = latest;
      }
    } catch {
      // silent
    }
  }, [ticketId, companyId]);

  // SSE-driven timeline updates — instant push for all channels
  useEventStream(companyId, ["sac"], {
    "sac:timeline-update": (data: unknown) => {
      const event = data as { ticketId: string; timestamp: number };
      if (event.ticketId === ticketId) {
        pollNewEvents();
      }
    },
  });

  // Fallback polling — 60s safety net in case SSE connection drops
  useEffect(() => {
    if (!ticketId || !companyId) return;
    if (channelType !== "WHATSAPP") return;

    const interval = setInterval(() => {
      pollNewEvents();
    }, 60_000);

    return () => clearInterval(interval);
  }, [ticketId, companyId, channelType, pollNewEvents]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // Manual refresh — exposed via button in the UI
  const [refreshing, setRefreshing] = useState(false);
  async function handleManualRefresh() {
    setRefreshing(true);
    await Promise.all([loadEvents(), loadSuggestions()]);
    setRefreshing(false);
  }

  // Load email recipients — only when Email tab is first opened
  const [recipientsLoaded, setRecipientsLoaded] = useState(false);
  useEffect(() => {
    if (activeTab !== "email" || recipientsLoaded) return;
    if (!ticketId || !companyId) return;
    getEmailRecipients(ticketId, companyId)
      .then((r) => {
        setRecipients(r);
        if (r.length > 0 && !emailTo) {
          setEmailTo(r[0].email);
        }
        setRecipientsLoaded(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ticketId, companyId, recipientsLoaded]);

  // Load WhatsApp recipients — only when WhatsApp tab is first opened
  const [waRecipientsLoaded, setWaRecipientsLoaded] = useState(false);
  useEffect(() => {
    if (activeTab !== "whatsapp" || waRecipientsLoaded) return;
    if (!ticketId || !companyId) return;
    getWhatsAppRecipients(ticketId, companyId)
      .then((r) => {
        setWaRecipients(r);
        if (r.length > 0 && !waTo) {
          setWaTo(r[0].phone);
        }
        setWaRecipientsLoaded(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ticketId, companyId, waRecipientsLoaded]);

  // Check WhatsApp connection status
  useEffect(() => {
    if (!companyId) return;
    getWhatsAppStatus(companyId)
      .then((s: { isConnected: boolean }) => setWaConnected(s.isConnected))
      .catch(() => setWaConnected(false));
  }, [companyId]);

  // Filter email-only events (no internal notes, only channel=EMAIL)
  const emailEvents = events.filter(
    (e) => e.channel === "EMAIL" && e.type === "message"
  );

  // Filter WhatsApp-only events (no internal notes, only channel=WHATSAPP)
  const whatsappEvents = events.filter(
    (e) => e.channel === "WHATSAPP" && e.type === "message"
  );

  // ---------------------------------------------------
  // Submit internal note
  // ---------------------------------------------------

  async function handleSubmitNote() {
    if (!noteContent.trim()) return;
    setSubmittingNote(true);
    try {
      if (isInternalNote) {
        await createInternalNote(ticketId, companyId, noteContent.trim());
        toast.success("Nota interna adicionada");
      } else {
        await createTicketReply({
          ticketId,
          companyId,
          content: noteContent.trim(),
          sendViaEmail: false,
        });
        toast.success("Comentário adicionado");
      }
      setNoteContent("");
      await loadEvents();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao adicionar nota"
      );
    } finally {
      setSubmittingNote(false);
    }
  }

  // ---------------------------------------------------
  // Upload file to ticket
  // ---------------------------------------------------

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("companyId", companyId);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro no upload");
      }

      const uploaded = await res.json();
      await attachFileToTicket(ticketId, companyId, {
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.mimeType,
        storagePath: uploaded.storagePath,
      });

      toast.success(`Arquivo "${file.name}" anexado ao ticket`);
      await loadEvents();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao anexar arquivo"
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  // ---------------------------------------------------
  // Email reply
  // ---------------------------------------------------

  async function handleSendEmail() {
    if (!emailContent.trim() || !emailTo) return;
    setSendingEmail(true);
    try {
      await sendEmailReply(
        ticketId,
        companyId,
        emailTo,
        emailSubject,
        emailContent.trim(),
        emailAttachments.length > 0 ? emailAttachments : undefined
      );
      setEmailContent("");
      setEmailAttachments([]);
      setEmailSubject(`Re: ${ticketSubject}`);
      toast.success("Email enviado");
      await loadEvents();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao enviar email"
      );
    } finally {
      setSendingEmail(false);
    }
  }

  async function handleEmailFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setEmailUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("companyId", companyId);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro no upload");
      }

      const uploaded = await res.json();
      setEmailAttachments((prev) => [
        ...prev,
        {
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          mimeType: uploaded.mimeType,
          storagePath: uploaded.storagePath,
        },
      ]);
      toast.success(`Anexo "${file.name}" adicionado`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao anexar arquivo"
      );
    } finally {
      setEmailUploading(false);
      if (emailFileInputRef.current) {
        emailFileInputRef.current.value = "";
      }
    }
  }

  // ---------------------------------------------------
  // WhatsApp reply
  // ---------------------------------------------------

  async function handleSendWhatsApp() {
    if (!waContent.trim() || !waTo) return;
    setSendingWa(true);
    try {
      await sendWhatsAppMessage(
        ticketId,
        companyId,
        waTo,
        waContent.trim(),
        waAttachments.length > 0 ? waAttachments : undefined
      );
      setWaContent("");
      setWaAttachments([]);
      toast.success("Mensagem WhatsApp enviada");
      await loadEvents();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao enviar mensagem"
      );
    } finally {
      setSendingWa(false);
    }
  }

  async function handleWaFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setWaUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("companyId", companyId);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro no upload");
      }

      const uploaded = await res.json();
      setWaAttachments((prev) => [
        ...prev,
        {
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          mimeType: uploaded.mimeType,
          storagePath: uploaded.storagePath,
        },
      ]);
      toast.success(`Anexo "${file.name}" adicionado`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao anexar arquivo"
      );
    } finally {
      setWaUploading(false);
      if (waFileInputRef.current) {
        waFileInputRef.current.value = "";
      }
    }
  }

  // ---------------------------------------------------
  // Toggle AI
  // ---------------------------------------------------

  async function handleToggleAi(checked: boolean) {
    setTogglingAi(true);
    try {
      await toggleTicketAi(ticketId, companyId, checked);
      setAiEnabled(checked);
      toast.success(checked ? "IA ativada para este ticket" : "IA desativada para este ticket");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar IA");
    } finally {
      setTogglingAi(false);
    }
  }

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">Timeline</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Atualizar timeline"
            className="h-7 w-7"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {aiConfigEnabled && (
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="ai-toggle" className="text-sm text-muted-foreground cursor-pointer">
              IA
            </Label>
            <Switch
              id="ai-toggle"
              checked={aiEnabled}
              onCheckedChange={handleToggleAi}
              disabled={togglingAi}
            />
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="whatsapp">
              WhatsApp
            </TabsTrigger>
          </TabsList>

          {/* ============================================================ */}
          {/* Todos Tab */}
          {/* ============================================================ */}
          <TabsContent value="todos" className="mt-4">
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
                          onActionComplete={() => { loadEvents(); loadSuggestions(); }}
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
                        onActionComplete={() => { loadEvents(); loadSuggestions(); }}
                        isGrouped={isGrouped}
                      />
                    );
                  });
                })()
              )}

            {/* Reply / internal note form */}
            <div className="border-t pt-4 space-y-3">
              {/* Internal note toggle */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isInternalNote}
                  onClick={() => setIsInternalNote((v) => !v)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-1 ${
                    isInternalNote ? "bg-yellow-400" : "bg-muted"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isInternalNote ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  Nota interna
                  {isInternalNote && (
                    <span className="ml-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-700 font-medium">
                      visível só para a equipe
                    </span>
                  )}
                </span>
              </div>

              <Textarea
                placeholder={
                  isInternalNote
                    ? "Escreva uma nota interna (não visível ao cliente)..."
                    : "Escreva um comentário..."
                }
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                rows={3}
                disabled={submittingNote}
                className={isInternalNote ? "border-yellow-200 bg-yellow-50/40" : ""}
              />
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? "Enviando..." : "Anexar ao ticket"}
                  </Button>
                </div>
                <Button
                  onClick={handleSubmitNote}
                  disabled={submittingNote || !noteContent.trim()}
                  size="sm"
                  className={
                    isInternalNote
                      ? "bg-yellow-500 hover:bg-yellow-600 text-white"
                      : ""
                  }
                >
                  {isInternalNote ? (
                    <Lock className="mr-2 h-4 w-4" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  {submittingNote
                    ? "Enviando..."
                    : isInternalNote
                      ? "Salvar nota interna"
                      : "Comentar"}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ============================================================ */}
          {/* Email Tab */}
          {/* ============================================================ */}
          <TabsContent value="email" className="mt-4">
            {/* Email thread */}
            <div className="space-y-4 max-h-[500px] overflow-y-auto mb-6">
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Carregando emails...
                </p>
              ) : emailEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum email neste ticket.
                </p>
              ) : (
                emailEvents.map((evt) => (
                  <EmailThreadItem
                    key={evt.id}
                    event={evt}
                    ticketSubject={ticketSubject}
                  />
                ))
              )}
              <div ref={emailEndRef} />
            </div>

            {/* Email reply form */}
            <div className="border-t pt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="email-to" className="text-sm font-medium">
                    Para
                  </Label>
                  <Select value={emailTo} onValueChange={setEmailTo}>
                    <SelectTrigger id="email-to">
                      <SelectValue placeholder="Selecione destinatario" />
                    </SelectTrigger>
                    <SelectContent>
                      {recipients.map((r) => (
                        <SelectItem key={r.email} value={r.email}>
                          {r.name}
                          {r.role ? ` (${r.role})` : ""} — {r.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="email-subject" className="text-sm font-medium">
                    Assunto
                  </Label>
                  <Input
                    id="email-subject"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                  />
                </div>
              </div>

              <Textarea
                placeholder="Escreva sua resposta por email..."
                value={emailContent}
                onChange={(e) => setEmailContent(e.target.value)}
                rows={4}
                disabled={sendingEmail}
              />

              {/* Attachment list */}
              {emailAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {emailAttachments.map((att) => (
                    <Badge key={att.storagePath} variant="secondary" className="text-xs">
                      <Paperclip className="mr-1 h-3 w-3" />
                      {att.fileName}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setEmailAttachments((prev) =>
                            prev.filter((a) => a.storagePath !== att.storagePath)
                          )
                        }
                      >
                        x
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <input
                    ref={emailFileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleEmailFileUpload}
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => emailFileInputRef.current?.click()}
                    disabled={emailUploading}
                  >
                    <Paperclip className="mr-2 h-4 w-4" />
                    {emailUploading ? "Enviando..." : "Anexar"}
                  </Button>
                </div>
                <Button
                  onClick={handleSendEmail}
                  disabled={sendingEmail || !emailContent.trim() || !emailTo}
                  size="sm"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {sendingEmail ? "Enviando..." : "Enviar"}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ============================================================ */}
          {/* WhatsApp Tab */}
          {/* ============================================================ */}
          <TabsContent value="whatsapp" className="mt-4">
            {/* Chat messages */}
            <div className="space-y-3 max-h-[500px] overflow-y-auto mb-6 bg-gray-50 rounded-lg p-4">
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Carregando mensagens...
                </p>
              ) : whatsappEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma mensagem WhatsApp neste ticket.
                </p>
              ) : (
                whatsappEvents.map((evt) => (
                  <WhatsAppBubble key={evt.id} event={evt} />
                ))
              )}
              <div ref={waEndRef} />
            </div>

            {/* WhatsApp reply form */}
            <div className="border-t pt-4 space-y-3">
              {waConnected === false && (
                <div className="flex items-center justify-between rounded-md bg-red-50 border border-red-200 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-red-700">
                    <Wifi className="h-4 w-4" />
                    <span>WhatsApp desconectado. Reconecte para enviar mensagens.</span>
                  </div>
                  <Link href="/configuracoes/canais">
                    <Button variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-100">
                      Reconectar
                    </Button>
                  </Link>
                </div>
              )}

              {waRecipients.length > 1 ? (
                <div>
                  <Label htmlFor="wa-to" className="text-sm font-medium">
                    Para
                  </Label>
                  <Select value={waTo} onValueChange={setWaTo}>
                    <SelectTrigger id="wa-to">
                      <SelectValue placeholder="Selecione o número" />
                    </SelectTrigger>
                    <SelectContent>
                      {waRecipients.map((r) => (
                        <SelectItem key={r.phone} value={r.phone}>
                          {r.name}
                          {r.role ? ` (${r.role})` : ""} — {r.phone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : waRecipients.length === 1 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MessageSquare className="h-4 w-4" />
                  <span>Para: <strong className="text-foreground">{waRecipients[0].name} — {waRecipients[0].phone}</strong></span>
                </div>
              ) : null}

              <Textarea
                placeholder="Digite sua mensagem..."
                value={waContent}
                onChange={(e) => setWaContent(e.target.value)}
                rows={3}
                disabled={sendingWa}
              />

              {/* Attachment list */}
              {waAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {waAttachments.map((att) => (
                    <Badge key={att.storagePath} variant="secondary" className="text-xs">
                      <Paperclip className="mr-1 h-3 w-3" />
                      {att.fileName}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setWaAttachments((prev) =>
                            prev.filter((a) => a.storagePath !== att.storagePath)
                          )
                        }
                      >
                        x
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <input
                    ref={waFileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleWaFileUpload}
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => waFileInputRef.current?.click()}
                    disabled={waUploading}
                  >
                    <Paperclip className="mr-2 h-4 w-4" />
                    {waUploading ? "Enviando..." : "Anexar"}
                  </Button>
                  <EmojiPicker onSelect={(emoji) => setWaContent((prev) => prev + emoji)} />
                </div>
                <Button
                  onClick={handleSendWhatsApp}
                  disabled={sendingWa || !waContent.trim() || !waTo || waConnected === false}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {sendingWa ? "Enviando..." : "Enviar"}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
