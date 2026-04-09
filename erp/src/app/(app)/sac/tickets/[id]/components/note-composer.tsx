"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Lock, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  createInternalNote,
  createTicketReply,
  attachFileToTicket,
} from "../../actions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NoteComposerProps {
  ticketId: string;
  companyId: string;
  onNoteSent: () => void; // triggers loadEvents() in parent
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NoteComposer({ ticketId, companyId, onNoteSent }: NoteComposerProps) {
  const [noteContent, setNoteContent] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [isInternalNote, setIsInternalNote] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      await onNoteSent();
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
      await onNoteSent();
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
  );
}
