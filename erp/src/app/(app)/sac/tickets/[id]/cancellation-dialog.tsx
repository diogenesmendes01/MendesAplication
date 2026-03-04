"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  requestCancellation,
  type CancellationType,
} from "../actions";

// ---------------------------------------------------------------------------
// CancellationDialog
// ---------------------------------------------------------------------------

interface CancellationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  companyId: string;
  proposalId?: string | null;
  boletoId?: string | null;
  onSuccess: () => void;
}

export function CancellationDialog({
  open,
  onOpenChange,
  ticketId,
  companyId,
  proposalId,
  boletoId,
  onSuccess,
}: CancellationDialogProps) {
  const [cancelType, setCancelType] = useState<CancellationType>("both");
  const [cancelJustification, setCancelJustification] = useState("");
  const [submittingCancel, setSubmittingCancel] = useState(false);

  // Reset & set default type when dialog opens
  useEffect(() => {
    if (open) {
      if (proposalId && boletoId) {
        setCancelType("both");
      } else if (proposalId) {
        setCancelType("proposal");
      } else {
        setCancelType("boletos");
      }
      setCancelJustification("");
    }
  }, [open, proposalId, boletoId]);

  async function handleRequestCancellation() {
    setSubmittingCancel(true);
    try {
      await requestCancellation(ticketId, companyId, cancelType, cancelJustification);
      toast.success("Solicitação de cancelamento enviada");
      onOpenChange(false);
      setCancelType("both");
      setCancelJustification("");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao solicitar cancelamento");
    } finally {
      setSubmittingCancel(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Solicitar Cancelamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>O que deseja cancelar? *</Label>
            <Select
              value={cancelType}
              onValueChange={(v) => setCancelType(v as CancellationType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {proposalId && boletoId && (
                  <SelectItem value="both">Proposta e Boletos</SelectItem>
                )}
                {proposalId && (
                  <SelectItem value="proposal">Apenas Proposta</SelectItem>
                )}
                {boletoId && (
                  <SelectItem value="boletos">Apenas Boletos</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="cancel-justification">Justificativa *</Label>
            <Textarea
              id="cancel-justification"
              value={cancelJustification}
              onChange={(e) => setCancelJustification(e.target.value)}
              placeholder="Descreva o motivo do cancelamento..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            onClick={handleRequestCancellation}
            disabled={submittingCancel || !cancelJustification.trim()}
          >
            {submittingCancel ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Solicitando...
              </>
            ) : (
              "Solicitar Cancelamento"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
