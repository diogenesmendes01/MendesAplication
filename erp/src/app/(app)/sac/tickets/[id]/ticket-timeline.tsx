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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  listTimelineEvents,
  createInternalNote,
  attachFileToTicket,
  type TimelineEvent,
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
// Timeline Event Item
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
// Main Component
// ---------------------------------------------------------------------------

interface TicketTimelineProps {
  ticketId: string;
  companyId: string;
}

export default function TicketTimeline({
  ticketId,
  companyId,
}: TicketTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);

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
            <TabsTrigger value="email" disabled>
              Email
            </TabsTrigger>
            <TabsTrigger value="whatsapp" disabled>
              WhatsApp
            </TabsTrigger>
          </TabsList>

          <TabsContent value="todos" className="mt-4">
            {/* Timeline events */}
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
        </Tabs>
      </CardContent>
    </Card>
  );
}
