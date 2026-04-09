"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
// Zod schema
// ---------------------------------------------------------------------------

const cancellationSchema = z.object({
  cancelType: z.enum(["both", "proposal", "boletos"]),
  justification: z.string().trim().min(1, "Justificativa é obrigatória"),
});

type CancellationFormData = z.infer<typeof cancellationSchema>;

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
  const form = useForm<CancellationFormData>({
    resolver: zodResolver(cancellationSchema),
    defaultValues: {
      cancelType: "both",
      justification: "",
    },
  });

  const { formState: { isSubmitting, errors } } = form;

  // Reset & set default type when dialog opens
  useEffect(() => {
    if (open) {
      let defaultType: CancellationType = "both";
      if (proposalId && boletoId) {
        defaultType = "both";
      } else if (proposalId) {
        defaultType = "proposal";
      } else {
        defaultType = "boletos";
      }
      form.reset({ cancelType: defaultType, justification: "" });
    }
  }, [open, proposalId, boletoId, form]);

  async function onSubmit(data: CancellationFormData) {
    try {
      await requestCancellation(ticketId, companyId, data.cancelType, data.justification);
      toast.success("Solicitação de cancelamento enviada");
      onOpenChange(false);
      form.reset({ cancelType: "both", justification: "" });
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao solicitar cancelamento");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Solicitar Cancelamento</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label>O que deseja cancelar? *</Label>
            <Controller
              control={form.control}
              name="cancelType"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
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
              )}
            />
            {errors.cancelType && (
              <p className="text-sm text-destructive mt-1">{errors.cancelType.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="cancel-justification">Justificativa *</Label>
            <Textarea
              id="cancel-justification"
              {...form.register("justification")}
              placeholder="Descreva o motivo do cancelamento..."
              rows={3}
            />
            {errors.justification && (
              <p className="text-sm text-destructive mt-1">{errors.justification.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Solicitando...
                </>
              ) : (
                "Solicitar Cancelamento"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
