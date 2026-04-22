"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { approveSuggestion, discardSuggestion } from "../ra-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuggestionContent {
  privateMessage?: string;
  publicMessage?: string;
  detectedType?: string;
  confidence?: number;
}

interface RaSuggestionCardProps {
  messageId: string;
  companyId: string;
  content: string;
  createdAt: string;
  onActionComplete?: () => void;
}

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

function parseContent(raw: string): SuggestionContent {
  try {
    return JSON.parse(raw);
  } catch {
    return { publicMessage: raw };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RaSuggestionCard({
  messageId,
  companyId,
  content,
  createdAt,
  onActionComplete,
}: RaSuggestionCardProps) {
  const parsed = parseContent(content);

  const [editing, setEditing] = useState(false);
  const [privateMsg, setPrivateMsg] = useState(parsed.privateMessage ?? "");
  const [publicMsg, setPublicMsg] = useState(parsed.publicMessage ?? "");
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [done, setDone] = useState(false);

  // ---- Approve ----
  async function handleApprove(editedPrivate?: string, editedPublic?: string) {
    setApproving(true);
    try {
      const result = await approveSuggestion(
        messageId,
        companyId,
        editedPrivate,
        editedPublic
      );
      if (!result.success) {
        toast.error(result.error ?? "Erro ao aprovar sugestão");
        return;
      }
      toast.success("Sugestão aprovada e enviada ao Reclame Aqui");
      setDone(true);
      setEditing(false);
      onActionComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setApproving(false);
    }
  }

  // ---- Discard ----
  async function handleDiscard() {
    setDiscarding(true);
    try {
      const result = await discardSuggestion(messageId, companyId);
      if (!result.success) {
        toast.error(result.error ?? "Erro ao descartar sugestão");
        return;
      }
      toast.success("Sugestão descartada");
      setDone(true);
      setDiscardDialogOpen(false);
      onActionComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setDiscarding(false);
    }
  }

  // ---- Already processed ----
  if (done) {
    return (
      <Card className="border-green-200 bg-green-50/50 p-4">
        <div className="flex items-center gap-2 text-sm text-green-700">
          <Check className="h-4 w-4" />
          <span>Sugestão processada</span>
        </div>
      </Card>
    );
  }

  // ---- Main card ----
  return (
    <>
      <Card className="border-2 border-dashed border-purple-300 bg-purple-50/40 p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg">🤖</span>
          <span className="text-sm font-semibold text-purple-800">
            Sugestão da IA
          </span>
          <span className="text-xs text-muted-foreground">
            {dateFmt.format(new Date(createdAt))}
          </span>
          {parsed.detectedType && (
            <Badge
              variant="outline"
              className="text-xs border-purple-300 text-purple-700"
            >
              {parsed.detectedType}
            </Badge>
          )}
          {parsed.confidence != null && (
            <Badge variant="secondary" className="text-xs">
              {Math.round(parsed.confidence * 100)}% confiança
            </Badge>
          )}
        </div>

        {/* Messages preview (read-only) */}
        {!editing && (
          <div className="space-y-2">
            {parsed.privateMessage && (
              <div className="rounded-md border border-purple-200 bg-white/60 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  📨 Mensagem Privada
                </p>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {parsed.privateMessage}
                </p>
              </div>
            )}
            {parsed.publicMessage && (
              <div className="rounded-md border border-purple-200 bg-white/60 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  📢 Mensagem Pública
                </p>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {parsed.publicMessage}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Editor mode */}
        {editing && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium">
                📨 Mensagem Privada
              </Label>
              <Textarea
                value={privateMsg}
                onChange={(e) => setPrivateMsg(e.target.value)}
                rows={4}
                className="mt-1 bg-white"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">
                📢 Mensagem Pública
              </Label>
              <Textarea
                value={publicMsg}
                onChange={(e) => setPublicMsg(e.target.value)}
                rows={4}
                className="mt-1 bg-white"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  handleApprove(
                    privateMsg || undefined,
                    publicMsg || undefined
                  )
                }
                disabled={approving || (!privateMsg.trim() && !publicMsg.trim())}
              >
                {approving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                )}
                {approving ? "Enviando..." : "Salvar e Enviar"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setPrivateMsg(parsed.privateMessage ?? "");
                  setPublicMsg(parsed.publicMessage ?? "");
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!editing && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => handleApprove()}
              disabled={approving || discarding}
            >
              {approving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              {approving ? "Enviando..." : "✅ Aprovar e Enviar"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={approving || discarding}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              ✏️ Editar
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50"
              disabled={approving || discarding}
              onClick={() => setDiscardDialogOpen(true)}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              ❌ Descartar
            </Button>
          </div>
        )}
      </Card>

      {/* Discard confirmation dialog */}
      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Descartar sugestão?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A sugestão da IA será descartada e não será enviada ao Reclame Aqui.
            Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiscardDialogOpen(false)}
              disabled={discarding}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDiscard}
              disabled={discarding}
            >
              {discarding ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {discarding ? "Descartando..." : "Confirmar Descarte"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
