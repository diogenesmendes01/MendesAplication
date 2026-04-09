"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
// Zod schema with conditional validation
// ---------------------------------------------------------------------------

const moderationSchema = z
  .object({
    reason: z.string().min(1, "Selecione um motivo"),
    justification: z.string().trim().min(1, "Justificativa é obrigatória"),
    companySearch: z.string(),
  })
  .refine(
    (data) =>
      Number(data.reason) !== RaModerationReason.OUTRA_EMPRESA ||
      data.companySearch.trim().length > 0,
    {
      message: "ID da empresa destino é obrigatório para este motivo",
      path: ["companySearch"],
    }
  );

type ModerationFormData = z.infer<typeof moderationSchema>;

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
  const form = useForm<ModerationFormData>({
    resolver: zodResolver(moderationSchema),
    defaultValues: {
      reason: "",
      justification: "",
      companySearch: "",
    },
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      reset({ reason: "", justification: "", companySearch: "" });
    }
  }, [open, reset]);

  const reasonValue = watch("reason");
  const reasonNum = reasonValue ? Number(reasonValue) : null;
  const isOutraEmpresa = reasonNum === RaModerationReason.OUTRA_EMPRESA;

  async function onSubmit(data: ModerationFormData) {
    const num = Number(data.reason);
    const isOE = num === RaModerationReason.OUTRA_EMPRESA;

    try {
      const result = await requestRaModeration(
        ticketId,
        companyId,
        num,
        data.justification.trim(),
        isOE && data.companySearch.trim()
          ? Number(data.companySearch.trim()) || undefined
          : undefined
      );

      if (!result.success) {
        toast.error(result.error ?? "Erro ao solicitar moderação");
        return;
      }

      toast.success("Solicitação de moderação enviada ao Reclame Aqui");
      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro inesperado"
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>⚖️ Solicitar Moderação — Reclame Aqui</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Reason select */}
          <div>
            <Label htmlFor="ra-mod-reason">Motivo *</Label>
            <Controller
              control={control}
              name="reason"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
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
              )}
            />
            {errors.reason && (
              <p className="text-xs text-destructive mt-1">{errors.reason.message}</p>
            )}
          </div>

          {/* Company search (only for reason = OUTRA_EMPRESA) */}
          {isOutraEmpresa && (
            <div>
              <Label htmlFor="ra-mod-company">
                ID da empresa destino *
              </Label>
              <Input
                id="ra-mod-company"
                {...register("companySearch")}
                placeholder="ID numérico da empresa no Reclame Aqui"
              />
              {errors.companySearch && (
                <p className="text-xs text-destructive mt-1">{errors.companySearch.message}</p>
              )}
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
              {...register("justification")}
              placeholder="Descreva o motivo da solicitação de moderação..."
              rows={4}
            />
            {errors.justification && (
              <p className="text-xs text-destructive mt-1">{errors.justification.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {isSubmitting ? "Enviando..." : "📤 Enviar Moderação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
