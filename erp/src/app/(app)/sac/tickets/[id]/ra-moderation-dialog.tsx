"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestRaModeration } from "../ra-actions";
import {
  RaModerationReason,
  MODERATION_REASON_LABELS,
} from "@/lib/reclameaqui/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RaModerationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  companyId: string;
  onSuccess?: () => void;
}

// ---------------------------------------------------------------------------
// Ordered list of reasons for the select
// ---------------------------------------------------------------------------

const REASON_OPTIONS: { value: number; label: string }[] = [
  { value: RaModerationReason.OUTRA_EMPRESA, label: MODERATION_REASON_LABELS[RaModerationReason.OUTRA_EMPRESA] },
  { value: RaModerationReason.DUPLICIDADE, label: MODERATION_REASON_LABELS[RaModerationReason.DUPLICIDADE] },
  { value: RaModerationReason.CONTEUDO_IMPROPRIO, label: MODERATION_REASON_LABELS[RaModerationReason.CONTEUDO_IMPROPRIO] },
  { value: RaModerationReason.TERCEIROS, label: MODERATION_REASON_LABELS[RaModerationReason.TERCEIROS] },
  { value: RaModerationReason.TRABALHISTA, label: MODERATION_REASON_LABELS[RaModerationReason.TRABALHISTA] },
  { value: RaModerationReason.NAO_VIOLOU_DIREITO, label: MODERATION_REASON_LABELS[RaModerationReason.NAO_VIOLOU_DIREITO] },
  { value: RaModerationReason.FRAUDE, label: MODERATION_REASON_LABELS[RaModerationReason.FRAUDE] },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RaModerationDialog({
  open,
  onOpenChange,
  ticketId,
  companyId,
  onSuccess,
}: RaModerationDialogProps) {
  const [reason, setReason] = useState<string>("");
  const [justification, setJustification] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reasonNum = reason ? Number(reason) : null;
  const isOutraEmpresa = reasonNum === RaModerationReason.OUTRA_EMPRESA;

  const canSubmit =
    reasonNum != null &&
    justification.trim().length > 0 &&
    (!isOutraEmpresa || companySearch.trim().length > 0);

  async function handleSubmit() {
    if (!canSubmit || reasonNum == null) return;

    setSubmitting(true);
    try {
      const result = await requestRaModeration(
        ticketId,
        companyId,
        reasonNum,
        justification.trim(),
        isOutraEmpresa && companySearch.trim()
          ? Number(companySearch.trim()) || undefined
          : undefined
      );

      if (!result.success) {
        toast.error(result.error ?? "Erro ao solicitar moderação");
        return;
      }

      toast.success("Solicitação de moderação enviada ao Reclame Aqui");
      // Reset form
      setReason("");
      setJustification("");
      setCompanySearch("");
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro inesperado"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>⚖️ Solicitar Moderação — Reclame Aqui</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Reason select */}
          <div>
            <Label htmlFor="ra-mod-reason">Motivo *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="ra-mod-reason">
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Company search (only for reason = OUTRA_EMPRESA) */}
          {isOutraEmpresa && (
            <div>
              <Label htmlFor="ra-mod-company">
                ID da empresa destino *
              </Label>
              <Input
                id="ra-mod-company"
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="ID numérico da empresa no Reclame Aqui"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Informe o ID da empresa correta no Reclame Aqui para migração
              </p>
            </div>
          )}

          {/* Justification */}
          <div>
            <Label htmlFor="ra-mod-justification">Justificativa *</Label>
            <Textarea
              id="ra-mod-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Descreva o motivo da solicitação de moderação..."
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {submitting ? "Enviando..." : "📤 Enviar Moderação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
