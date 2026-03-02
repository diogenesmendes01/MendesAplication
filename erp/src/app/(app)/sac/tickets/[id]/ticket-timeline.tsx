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
  listTimelineEvents,
  createInternalNote,
  attachFileToTicket,
  getEmailRecipients,
  sendEmailReply,
  getWhatsAppRecipients,
  sendWhatsAppMessage,
  type TimelineEvent,
  type EmailRecipient,
  type WhatsAppRecipient,
} from "../actions";

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

function TimelineItem({ event }: { event: TimelineEvent }) {
  const origin = originLabel(event);
  const isNote = event.type === "internal_note";

  return (
    <div className={`flex gap-3 ${isNote ? "rounded-lg bg-yellow-50 p-3" : ""}`}>
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
          <p className="mt-1 text-sm whitespace-pre-wrap leading-relaxed">
            {event.content}
          </p>
        )}

        {/* Attachments */}
        {event.attachments.length > 0 && (
          <div className="mt-2 space-y-1">
            {event.attachments.map((att) => (
              <a
                key={att.id}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-primary hover:underline"
              >
                <Paperclip className="h-3 w-3" />
                <span>{att.fileName}</span>
                <span className="text-muted-foreground">
                  ({formatFileSize(att.fileSize)})
                </span>
                <Download className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
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
        <div className="mt-3 border-t pt-3 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Anexos:</span>
          {event.attachments.map((att) => (
            <a
              key={att.id}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-primary hover:underline"
            >
              <Paperclip className="h-3 w-3" />
              <span>{att.fileName}</span>
              <span className="text-muted-foreground">
                ({formatFileSize(att.fileSize)})
              </span>
              <Download className="h-3 w-3" />
            </a>
          ))}
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
            ? "rounded-br-md bg-green-100 text-green-900"
            : "rounded-bl-md bg-white border text-foreground"
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
        </div>

        {/* Content */}
        <p className="text-sm whitespace-pre-wrap leading-relaxed">
          {event.content}
        </p>

        {/* Attachments */}
        {event.attachments.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {event.attachments.map((att) => (
              <a
                key={att.id}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Paperclip className="h-3 w-3" />
                <span>{att.fileName}</span>
                <span className="text-muted-foreground">
                  ({formatFileSize(att.fileSize)})
                </span>
              </a>
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div className="flex justify-end mt-1">
          <span className="text-[10px] text-muted-foreground">
            {dateFmt.format(new Date(event.createdAt))}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface TicketTimelineProps {
  ticketId: string;
  companyId: string;
  ticketSubject: string;
}

export default function TicketTimeline({
  ticketId,
  companyId,
  ticketSubject,
}: TicketTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
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
    { id: string; fileName: string }[]
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
    { id: string; fileName: string }[]
  >([]);
  const waFileInputRef = useRef<HTMLInputElement>(null);
  const waEndRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async () => {
    if (!ticketId || !companyId) return;
    setLoading(true);
    try {
      const data = await listTimelineEvents(ticketId, companyId);
      setEvents(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [ticketId, companyId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // Load email recipients
  useEffect(() => {
    if (!ticketId || !companyId) return;
    getEmailRecipients(ticketId, companyId)
      .then((r) => {
        setRecipients(r);
        if (r.length > 0 && !emailTo) {
          setEmailTo(r[0].email);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, companyId]);

  // Load WhatsApp recipients
  useEffect(() => {
    if (!ticketId || !companyId) return;
    getWhatsAppRecipients(ticketId, companyId)
      .then((r) => {
        setWaRecipients(r);
        if (r.length > 0 && !waTo) {
          setWaTo(r[0].phone);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, companyId]);

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
      await createInternalNote(ticketId, companyId, noteContent.trim());
      setNoteContent("");
      toast.success("Nota interna adicionada");
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
      const attachmentIds = emailAttachments.map((a) => a.id);
      await sendEmailReply(
        ticketId,
        companyId,
        emailTo,
        emailSubject,
        emailContent.trim(),
        attachmentIds.length > 0 ? attachmentIds : undefined
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
      const att = await attachFileToTicket(ticketId, companyId, {
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.mimeType,
        storagePath: uploaded.storagePath,
      });

      setEmailAttachments((prev) => [
        ...prev,
        { id: att.id, fileName: uploaded.fileName },
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
      const attachmentIds = waAttachments.map((a) => a.id);
      await sendWhatsAppMessage(
        ticketId,
        companyId,
        waTo,
        waContent.trim(),
        attachmentIds.length > 0 ? attachmentIds : undefined
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
      const att = await attachFileToTicket(ticketId, companyId, {
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        mimeType: uploaded.mimeType,
        storagePath: uploaded.storagePath,
      });

      setWaAttachments((prev) => [
        ...prev,
        { id: att.id, fileName: uploaded.fileName },
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
  // Render
  // ---------------------------------------------------

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="todos">
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
                events.map((evt) => <TimelineItem key={evt.id} event={evt} />)
              )}
              <div ref={timelineEndRef} />
            </div>

            {/* Internal note form */}
            <div className="border-t pt-4 space-y-3">
              <Textarea
                placeholder="Escreva uma nota interna..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                rows={3}
                disabled={submittingNote}
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
                >
                  <Send className="mr-2 h-4 w-4" />
                  {submittingNote ? "Enviando..." : "Comentar"}
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
                    <Badge key={att.id} variant="secondary" className="text-xs">
                      <Paperclip className="mr-1 h-3 w-3" />
                      {att.fileName}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setEmailAttachments((prev) =>
                            prev.filter((a) => a.id !== att.id)
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
                    <Badge key={att.id} variant="secondary" className="text-xs">
                      <Paperclip className="mr-1 h-3 w-3" />
                      {att.fileName}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setWaAttachments((prev) =>
                            prev.filter((a) => a.id !== att.id)
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
                </div>
                <Button
                  onClick={handleSendWhatsApp}
                  disabled={sendingWa || !waContent.trim() || !waTo}
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
