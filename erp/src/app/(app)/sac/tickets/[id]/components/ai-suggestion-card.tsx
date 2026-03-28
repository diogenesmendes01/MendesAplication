"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Pencil,
  X,
  Send,
  Loader2,
  Bot,
  BarChart3,
  MessageSquare,
  Tag,
  User,
} from "lucide-react";
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
import {
  approveSuggestionAction,
  rejectSuggestionAction,
} from "../suggestion-actions";
import { timeAgo, confidenceColor, confidenceBarColor } from "@/utils/suggestion-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuggestedAction {
  toolName: string;
  args: Record<string, unknown>;
  order: number;
}

interface Analysis {
  intent?: string;
  clientIdentified?: boolean;
  clientName?: string;
  clientCnpj?: string;
  dataFound?: Record<string, unknown>;
  toolsExecuted?: string[];
  searchResults?: Array<{ similarity?: number }>;
  iterationsUsed?: number;
  [key: string]: unknown;
}

export interface AiSuggestionData {
  id: string;
  ticketId: string;
  companyId: string;
  channel: string;
  analysis: Analysis;
  suggestedResponse: string;
  suggestedSubject?: string | null;
  suggestedActions: SuggestedAction[];
  raPrivateMessage?: string | null;
  raPublicMessage?: string | null;
  raDetectedType?: string | null;
  raSuggestModeration?: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EDITED" | "EXPIRED" | "PROCESSING";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  editedResponse?: string | null;
  editedSubject?: string | null;
  rejectionReason?: string | null;
  confidence: number;
  createdAt: string;
  reviewer?: { id: string; name: string } | null;
}

interface AiSuggestionCardProps {
  suggestion: AiSuggestionData;
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

function statusConfig(status: string) {
  switch (status) {
    case "PENDING":
      return { border: "border-yellow-300", bg: "bg-yellow-50/60", label: "Pendente" };
    case "APPROVED":
      return { border: "border-green-300", bg: "bg-green-50/60", label: "Aprovado" };
    case "REJECTED":
      return { border: "border-red-300", bg: "bg-red-50/60", label: "Rejeitado" };
    case "EDITED":
      return { border: "border-blue-300", bg: "bg-blue-50/60", label: "Editado" };
    case "EXPIRED":
      return { border: "border-gray-300", bg: "bg-gray-50/60", label: "Expirado" };
    case "PROCESSING":
      return { border: "border-purple-300", bg: "bg-purple-50/60", label: "Processando" };
    default:
      return { border: "border-gray-300", bg: "bg-gray-50/60", label: status };
  }
}

function toolNameLabel(toolName: string): string {
  const labels: Record<string, string> = {
    RESPOND: "Enviar resposta",
    RESPOND_EMAIL: "Enviar email",
    RESPOND_RECLAMEAQUI: "Responder Reclame Aqui",
    ESCALATE: "Escalar para humano",
    CREATE_NOTE: "Criar nota interna",
    LINK_TICKET_TO_CLIENT: "Vincular ao cliente",
  };
  return labels[toolName] || toolName;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AiSuggestionCard({
  suggestion,
  onActionComplete,
}: AiSuggestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editResponse, setEditResponse] = useState(suggestion.suggestedResponse);
  const [editSubject, setEditSubject] = useState(suggestion.suggestedSubject ?? "");
  const [editPrivate, setEditPrivate] = useState(suggestion.raPrivateMessage ?? "");
  const [editPublic, setEditPublic] = useState(suggestion.raPublicMessage ?? "");
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const isPending = suggestion.status === "PENDING";
  const isRA = suggestion.channel === "RECLAMEAQUI";
  const isEmail = suggestion.channel === "EMAIL";
  const sc = statusConfig(suggestion.status);
  const analysis = suggestion.analysis;

  // ---- Approve ----
  async function handleApprove(edited?: {
    response?: string;
    subject?: string;
  }) {
    setApproving(true);
    try {
      let editedResponse: string | undefined;
      let editedSubject: string | undefined;

      if (edited) {
        if (isRA) {
          editedResponse = JSON.stringify({
            privateMessage: editPrivate,
            publicMessage: editPublic,
          });
        } else {
          editedResponse = edited.response;
          editedSubject = edited.subject;
        }
      }

      await approveSuggestionAction(
        suggestion.id,
        suggestion.companyId,
        editedResponse,
        editedSubject,
      );
      toast.success("Sugestão aprovada e executada");
      setEditing(false);
      onActionComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar sugestão");
    } finally {
      setApproving(false);
    }
  }

  // ---- Reject ----
  async function handleReject() {
    setRejecting(true);
    try {
      await rejectSuggestionAction(
        suggestion.id,
        suggestion.companyId,
        rejectionReason || undefined,
      );
      toast.success("Sugestão rejeitada");
      setRejectDialogOpen(false);
      onActionComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao rejeitar sugestão");
    } finally {
      setRejecting(false);
    }
  }

  // ---- Resolved states ----
  if (!isPending) {
    return (
      <Card className={`border-2 ${sc.border} ${sc.bg} p-4 space-y-2`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Sugestão da IA</span>
          <Badge variant="outline" className="text-xs">
            {sc.label}
          </Badge>
        </div>

        {suggestion.reviewer && suggestion.reviewedAt && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            {suggestion.status === "EDITED"
              ? `Editado e aprovado por ${suggestion.reviewer.name}`
              : suggestion.status === "APPROVED"
                ? `Aprovado por ${suggestion.reviewer.name}`
                : `Rejeitado por ${suggestion.reviewer.name}`}
            {" às "}
            {dateFmt.format(new Date(suggestion.reviewedAt))}
          </div>
        )}

        {suggestion.status === "REJECTED" && suggestion.rejectionReason && (
          <p className="text-xs text-muted-foreground">
            Motivo: {suggestion.rejectionReason}
          </p>
        )}

        <div className="rounded-md border bg-white/60 p-3">
          <p className="text-sm whitespace-pre-wrap leading-relaxed line-clamp-3">
            {suggestion.editedResponse || suggestion.suggestedResponse}
          </p>
        </div>
      </Card>
    );
  }

  // ---- Pending: Full card ----
  return (
    <>
      <Card className={`border-2 ${sc.border} ${sc.bg} p-4 space-y-4`}>
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg">🤖</span>
          <span className="text-sm font-semibold">Sugestão da IA</span>
          {isRA && (
            <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">
              Reclame Aqui
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {timeAgo(suggestion.createdAt)}
          </span>
          <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700 bg-yellow-50">
            ⏳ Pendente
          </Badge>
        </div>

        {/* 📊 Analysis Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            Análise
          </div>
          <div className="rounded-md border bg-white/60 p-3 space-y-2 text-sm">
            {analysis.clientIdentified && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Cliente:</span>
                <span className="font-medium">
                  {analysis.clientName || "Identificado"}
                  {analysis.clientCnpj && ` (${analysis.clientCnpj})`}
                </span>
              </div>
            )}
            {analysis.intent && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Intenção:</span>
                <span className="font-medium">{analysis.intent}</span>
              </div>
            )}
            {isRA && suggestion.raDetectedType && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Tipo:</span>
                <Badge variant="secondary" className="text-xs">
                  {suggestion.raDetectedType}
                </Badge>
                {suggestion.raSuggestModeration && (
                  <Badge variant="destructive" className="text-xs">
                    ⚠️ Moderação sugerida
                  </Badge>
                )}
              </div>
            )}
            {/* Confidence bar */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Confiança:</span>
              <div
                className="flex-1 max-w-[200px] h-2 bg-gray-200 rounded-full overflow-hidden"
                role="progressbar"
                aria-label="Nível de confiança da sugestão"
                aria-valuenow={Math.round(suggestion.confidence * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={`h-full rounded-full ${confidenceBarColor(suggestion.confidence)}`}
                  style={{ width: `${Math.round(suggestion.confidence * 100)}%` }}
                />
              </div>
              <Badge className={`text-xs ${confidenceColor(suggestion.confidence)}`}>
                {Math.round(suggestion.confidence * 100)}%
              </Badge>
            </div>
            {analysis.toolsExecuted && analysis.toolsExecuted.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground text-xs">Tools usadas:</span>
                {analysis.toolsExecuted.map((t: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 💬 Suggested Response */}
        {!editing && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <MessageSquare className="h-4 w-4 text-green-600" />
              {isRA ? "Mensagens sugeridas" : "Resposta sugerida"}
            </div>

            {isRA ? (
              <div className="space-y-2">
                {suggestion.raPrivateMessage && (
                  <div className="rounded-md border bg-white/60 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      🔒 Mensagem Privada
                    </p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {suggestion.raPrivateMessage}
                    </p>
                  </div>
                )}
                {suggestion.raPublicMessage && (
                  <div className="rounded-md border bg-white/60 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      🌐 Mensagem Pública
                    </p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {suggestion.raPublicMessage}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border bg-white/60 p-3">
                {isEmail && suggestion.suggestedSubject && (
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Assunto: {suggestion.suggestedSubject}
                  </p>
                )}
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {suggestion.suggestedResponse}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Edit mode */}
        {editing && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Pencil className="h-4 w-4 text-blue-600" />
              Editar resposta
            </div>

            {isRA ? (
              <>
                <div>
                  <Label className="text-xs font-medium">🔒 Mensagem Privada</Label>
                  <Textarea
                    value={editPrivate}
                    onChange={(e) => setEditPrivate(e.target.value)}
                    rows={4}
                    className="mt-1 bg-white"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">🌐 Mensagem Pública</Label>
                  <Textarea
                    value={editPublic}
                    onChange={(e) => setEditPublic(e.target.value)}
                    rows={4}
                    className="mt-1 bg-white"
                  />
                </div>
              </>
            ) : (
              <>
                {isEmail && (
                  <div>
                    <Label className="text-xs font-medium">Assunto</Label>
                    <Textarea
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      rows={1}
                      className="mt-1 bg-white"
                    />
                  </div>
                )}
                <div>
                  <Label className="text-xs font-medium">Resposta</Label>
                  <Textarea
                    value={editResponse}
                    onChange={(e) => setEditResponse(e.target.value)}
                    rows={6}
                    className="mt-1 bg-white"
                  />
                </div>
              </>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  handleApprove({
                    response: editResponse,
                    subject: editSubject || undefined,
                  })
                }
                disabled={approving}
              >
                {approving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                )}
                {approving ? "Enviando..." : "Salvar e Aprovar"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setEditResponse(suggestion.suggestedResponse);
                  setEditSubject(suggestion.suggestedSubject ?? "");
                  setEditPrivate(suggestion.raPrivateMessage ?? "");
                  setEditPublic(suggestion.raPublicMessage ?? "");
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* 🏷️ Suggested Actions */}
        {!editing && suggestion.suggestedActions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Tag className="h-4 w-4 text-purple-600" />
              Ações que seriam executadas
            </div>
            <div className="rounded-md border bg-white/60 p-3 space-y-1">
              {(suggestion.suggestedActions as SuggestedAction[])
                .sort((a, b) => a.order - b.order)
                .map((action, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {action.toolName}
                    </Badge>
                    <span className="text-muted-foreground">
                      {toolNameLabel(action.toolName)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {!editing && (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => handleApprove()}
              disabled={approving || rejecting}
            >
              {approving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              {approving ? "Aprovando..." : "✅ Aprovar"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={approving || rejecting}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              ✏️ Editar
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50"
              disabled={approving || rejecting}
              onClick={() => setRejectDialogOpen(true)}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              ❌ Rejeitar
            </Button>
          </div>
        )}
      </Card>

      {/* Reject confirmation dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rejeitar sugestão?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A sugestão da IA será rejeitada. Opcionalmente, informe o motivo
              para melhorar futuras sugestões.
            </p>
            <div>
              <Label className="text-sm">Motivo (opcional)</Label>
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
                placeholder="Ex: Tom inadequado, dados incorretos..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={rejecting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejecting}
            >
              {rejecting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {rejecting ? "Rejeitando..." : "Confirmar Rejeição"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
