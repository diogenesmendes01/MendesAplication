"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Paperclip,
  Download,
  Send,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link2,
  ImageIcon,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  getEmailRecipients,
  sendEmailReply,
  type TimelineEvent,
  type EmailRecipient,
  type AttachmentData,
} from "../../actions";

// ---------------------------------------------------------------------------
// Helpers (duplicated from parent — shared helpers could be extracted later)
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

// ---------------------------------------------------------------------------
// Helpers for rich text formatting
// ---------------------------------------------------------------------------

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
    el.value.substring(0, start) +
    before +
    selected +
    after +
    el.value.substring(end);
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
// AttachmentList
// ---------------------------------------------------------------------------

function AttachmentList({
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
// Email Thread Item
// ---------------------------------------------------------------------------

function EmailThreadItem({
  event,
  ticketSubject,
}: {
  event: TimelineEvent;
  ticketSubject: string;
}) {
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
          <span className="text-muted-foreground font-medium w-16 shrink-0">
            De:
          </span>
          <span className="font-semibold">
            {senderName}
            {senderRole && (
              <span className="font-normal text-muted-foreground">
                {" "}
                ({senderRole})
              </span>
            )}
          </span>
          {isInbound && (
            <Badge
              variant="outline"
              className="text-xs px-1.5 py-0 border-green-300 text-green-700"
            >
              Recebido
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium w-16 shrink-0">
            Para:
          </span>
          <span>
            {isInbound ? "Suporte" : event.contactName ?? "Cliente"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium w-16 shrink-0">
            Assunto:
          </span>
          <span>Re: {ticketSubject}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium w-16 shrink-0">
            Data:
          </span>
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
          <span className="text-xs font-medium text-muted-foreground">
            Anexos:
          </span>
          <AttachmentList attachments={event.attachments} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmailComposer
// ---------------------------------------------------------------------------

export interface EmailComposerProps {
  ticketId: string;
  companyId: string;
  ticketSubject: string;
  events: TimelineEvent[];
  loading: boolean;
  onMessageSent: () => void;
}

export function EmailComposer({
  ticketId,
  companyId,
  ticketSubject,
  events,
  loading,
  onMessageSent,
}: EmailComposerProps) {
  // Email state
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState(`Re: ${ticketSubject}`);
  const [emailContent, setEmailContent] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailUploading, setEmailUploading] = useState(false);
  const [emailAttachments, setEmailAttachments] = useState<
    (AttachmentData & { fileName: string })[]
  >([]);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [recipientsLoaded, setRecipientsLoaded] = useState(false);

  // Refs
  const emailFileInputRef = useRef<HTMLInputElement>(null);
  const emailEndRef = useRef<HTMLDivElement>(null);
  const emailTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter email-only events
  const emailEvents = events.filter(
    (e) => e.channel === "EMAIL" && e.type === "message"
  );

  // Auto-scroll to bottom when new email events arrive
  useEffect(() => {
    emailEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [emailEvents.length]);

  // Load email recipients on mount (lazy — this component only renders when tab is active)
  useEffect(() => {
    if (recipientsLoaded) return;
    if (!ticketId || !companyId) return;
    getEmailRecipients(ticketId, companyId)
      .then((r) => {
        setRecipients(r);
        if (r.length > 0 && !emailTo) {
          setEmailTo(r[0].email);
        }
        setRecipientsLoaded(true);
      })
      // eslint-disable-next-line no-console
      .catch((err) => { console.warn("SAC: failed to load email recipients", err); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, companyId, recipientsLoaded]);

  // ---------------------------------------------------
  // Email reply
  // ---------------------------------------------------

  const handleSendEmail = useCallback(async () => {
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
      onMessageSent();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao enviar email"
      );
    } finally {
      setSendingEmail(false);
    }
  }, [
    emailContent,
    emailTo,
    ticketId,
    companyId,
    emailSubject,
    emailAttachments,
    ticketSubject,
    onMessageSent,
  ]);

  async function handleEmailFileUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
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

  return (
    <>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        {/* Rich text toolbar */}
        <div className="flex items-center gap-0.5 flex-wrap border rounded-t-md p-1.5 bg-muted/30 border-b-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Negrito"
            onClick={() =>
              insertWrap(emailTextareaRef, "<b>", "</b>", setEmailContent)
            }
          >
            <Bold className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Italico"
            onClick={() =>
              insertWrap(emailTextareaRef, "<i>", "</i>", setEmailContent)
            }
          >
            <Italic className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Sublinhado"
            onClick={() =>
              insertWrap(emailTextareaRef, "<u>", "</u>", setEmailContent)
            }
          >
            <Underline className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Tachado"
            onClick={() =>
              insertWrap(emailTextareaRef, "<s>", "</s>", setEmailContent)
            }
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Lista"
            onClick={() => {
              setEmailContent((v) => v + "\n• ");
            }}
          >
            <List className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Lista numerada"
            onClick={() => {
              setEmailContent((v) => v + "\n1. ");
            }}
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Link"
            onClick={() =>
              insertWrap(
                emailTextareaRef,
                '<a href="URL">',
                "</a>",
                setEmailContent
              )
            }
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 active:scale-75 transition-transform duration-75"
            title="Imagem"
            onClick={() =>
              insertWrap(
                emailTextareaRef,
                '<img src="',
                '" alt="" />',
                setEmailContent
              )
            }
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </Button>
          <div className="ml-auto">
            <Button
              type="button"
              variant={showEmailPreview ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowEmailPreview((v) => !v)}
            >
              {showEmailPreview ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {showEmailPreview ? "Fechar previa" : "Previa HTML"}
            </Button>
          </div>
        </div>
        <Textarea
          ref={emailTextareaRef}
          placeholder="Escreva sua resposta por email..."
          value={emailContent}
          onChange={(e) => setEmailContent(e.target.value)}
          rows={4}
          disabled={sendingEmail}
          className="rounded-t-none"
        />
        {showEmailPreview && emailContent && (
          <div
            className="min-h-[60px] rounded-md border bg-white p-3 text-sm prose prose-sm max-w-none animate-in fade-in slide-in-from-top-2 duration-200"
            dangerouslySetInnerHTML={{ __html: emailContent }}
          />
        )}

        {/* Attachment list */}
        {emailAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {emailAttachments.map((att) => (
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
                    setEmailAttachments((prev) =>
                      prev.filter(
                        (a) => a.storagePath !== att.storagePath
                      )
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
    </>
  );
}
