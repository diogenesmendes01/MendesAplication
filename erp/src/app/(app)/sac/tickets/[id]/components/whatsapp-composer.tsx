"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  MessageSquare,
  Paperclip,
  Download,
  Send,
  Smile,
  Bot,
  Wifi,
  Bold,
  Italic,
  Strikethrough,
  StickerIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import Link from "next/link";
import {
  getWhatsAppRecipients,
  sendWhatsAppMessage,
  type TimelineEvent,
  type WhatsAppRecipient,
  type AttachmentData,
} from "../../actions";
import { getWhatsAppStatus } from "../../../../configuracoes/canais/actions";

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

function insertWrap(
  ref: React.RefObject<HTMLTextAreaElement>,
  before: string,
  after: string,
  setter: (v: string) => void
) {
  const el = ref.current;
  if (!el) return;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const selected = el.value.substring(start, end) || "texto";
  const newValue =
    el.value.substring(0, start) + before + selected + after + el.value.substring(end);
  setter(newValue);
  setTimeout(() => {
    el.focus();
    el.setSelectionRange(
      start + before.length,
      start + before.length + selected.length
    );
  }, 0);
}

// ---------------------------------------------------------------------------
// WhatsApp Chat Bubble
// ---------------------------------------------------------------------------

export function WhatsAppBubble({ event }: { event: TimelineEvent }) {
  const isOutbound = event.direction === "OUTBOUND";
  const origin = originLabel(event);
  const senderName = isOutbound
    ? event.sender?.name ?? "Atendente"
    : event.contactName ?? "Contato";
  const senderRole = isOutbound ? null : event.contactRole;

  return (
    <div
      className={`flex animate-in fade-in slide-in-from-bottom-1 duration-200 ${isOutbound ? "justify-end" : "justify-start"}`}
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
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 border-purple-300 text-purple-700"
            >
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
        <WhatsAppAttachmentList attachments={event.attachments} />

        {/* Timestamp + delivery status */}
        <div className="flex justify-end items-center gap-1 mt-1">
          <span className="text-[10px] text-muted-foreground">
            {dateFmt.format(new Date(event.createdAt))}
          </span>
          {isOutbound &&
            event.deliveryStatus &&
            event.deliveryStatus !== "DISCARDED" && (
              <span
                className="text-[10px] text-muted-foreground"
                title={event.deliveryStatus}
              >
                {event.deliveryStatus === "SENT" ? (
                  "\u2713"
                ) : event.deliveryStatus === "DELIVERED" ? (
                  "\u2713\u2713"
                ) : event.deliveryStatus === "READ" ? (
                  <span className="text-blue-500">{"\u2713\u2713"}</span>
                ) : null}
              </span>
            )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachment helpers (local to WhatsApp bubble)
// ---------------------------------------------------------------------------

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function WhatsAppAttachmentList({
  attachments,
}: {
  attachments: TimelineEvent["attachments"];
}) {
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

// ---------------------------------------------------------------------------
// Emoji & Sticker Pickers
// ---------------------------------------------------------------------------

const COMMON_EMOJIS = [
  "\u{1F600}", "\u{1F601}", "\u{1F602}", "\u{1F603}", "\u{1F604}", "\u{1F605}", "\u{1F609}", "\u{1F60A}",
  "\u{1F60D}", "\u{1F618}", "\u{1F60E}", "\u{1F914}", "\u{1F44D}", "\u{1F44E}", "\u{1F44B}", "\u{1F64F}",
  "\u{1F389}", "\u{1F525}", "\u{2705}", "\u{274C}", "\u{26A0}\u{FE0F}", "\u{2764}\u{FE0F}", "\u{1F4E7}", "\u{1F4DE}",
  "\u{1F4CB}", "\u{1F4B0}", "\u{23F0}", "\u{1F504}", "\u{1F4AC}", "\u{270F}\u{FE0F}", "\u{1F50D}", "\u{1F6A8}",
];

const STICKERS = ["\u{1F44D}", "\u{1F60A}", "\u{2764}\u{FE0F}", "\u{2705}", "\u{1F389}", "\u{1F64F}"];

function StickerPicker({ onSelect }: { onSelect: (sticker: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" type="button" title="Stickers">
          <StickerIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <div className="grid grid-cols-3 gap-1">
          {STICKERS.map((s) => (
            <button
              key={s}
              type="button"
              className="flex h-10 w-full items-center justify-center rounded hover:bg-accent text-2xl hover:scale-125 transition-transform duration-150 active:scale-110"
              onClick={() => onSelect(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded hover:bg-accent text-lg hover:scale-125 transition-transform duration-150"
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
// WhatsAppComposer
// ---------------------------------------------------------------------------

export interface WhatsAppComposerProps {
  ticketId: string;
  companyId: string;
  events: TimelineEvent[];
  loading: boolean;
  onMessageSent: () => void;
}

export function WhatsAppComposer({
  ticketId,
  companyId,
  events,
  loading,
  onMessageSent,
}: WhatsAppComposerProps) {
  // WhatsApp state
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
  const waTextareaRef = useRef<HTMLTextAreaElement>(null);

  // WhatsApp connection status
  const [waConnected, setWaConnected] = useState<boolean | null>(null);

  // Recipients loading
  const [waRecipientsLoaded, setWaRecipientsLoaded] = useState(false);

  useEffect(() => {
    if (waRecipientsLoaded) return;
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
  }, [ticketId, companyId, waRecipientsLoaded]);

  // Check WhatsApp connection status
  useEffect(() => {
    if (!companyId) return;
    getWhatsAppStatus(companyId)
      .then((s: { isConnected: boolean }) => setWaConnected(s.isConnected))
      .catch(() => setWaConnected(false));
  }, [companyId]);

  // Filter WhatsApp-only events
  const whatsappEvents = events.filter(
    (e) => e.channel === "WHATSAPP" && e.type === "message"
  );

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
      onMessageSent();
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

  return (
    <>
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
              <span>
                WhatsApp desconectado. Reconecte para enviar mensagens.
              </span>
            </div>
            <Link href="/configuracoes/canais">
              <Button
                variant="outline"
                size="sm"
                className="border-red-300 text-red-700 hover:bg-red-100"
              >
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
                <SelectValue placeholder="Selecione o numero" />
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
            <span>
              Para:{" "}
              <strong className="text-foreground">
                {waRecipients[0].name} — {waRecipients[0].phone}
              </strong>
            </span>
          </div>
        ) : null}

        {/* WA formatting bar */}
        <div className="flex items-center gap-0.5 border rounded-t-md p-1.5 bg-muted/30 border-b-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Negrito (*texto*)"
            onClick={() => insertWrap(waTextareaRef, "*", "*", setWaContent)}
          >
            <Bold className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Italico (_texto_)"
            onClick={() => insertWrap(waTextareaRef, "_", "_", setWaContent)}
          >
            <Italic className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Tachado (~texto~)"
            onClick={() => insertWrap(waTextareaRef, "~", "~", setWaContent)}
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Codigo (`texto`)"
            onClick={() => insertWrap(waTextareaRef, "`", "`", setWaContent)}
          >
            <span className="font-mono text-xs font-bold">{"<>"}</span>
          </Button>
        </div>
        <Textarea
          ref={waTextareaRef}
          placeholder="Digite sua mensagem..."
          value={waContent}
          onChange={(e) => setWaContent(e.target.value)}
          rows={3}
          disabled={sendingWa}
          className="rounded-t-none"
        />

        {/* Attachment list */}
        {waAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {waAttachments.map((att) => (
              <Badge
                key={att.storagePath}
                variant="secondary"
                className="text-xs"
              >
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
            <EmojiPicker
              onSelect={(emoji) => setWaContent((prev) => prev + emoji)}
            />
            <StickerPicker
              onSelect={(s) => setWaContent((prev) => prev + s)}
            />
          </div>
          <Button
            onClick={handleSendWhatsApp}
            disabled={
              sendingWa || !waContent.trim() || !waTo || waConnected === false
            }
            size="sm"
            className="bg-green-600 hover:bg-green-700"
          >
            <Send className="mr-2 h-4 w-4" />
            {sendingWa ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      </div>
    </>
  );
}
