"use client";

import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  FileText,
  X,
  Loader2,
  Upload,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  requestRefund,
  executeRefund,
  attachFileToTicket,
} from "../actions";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const requestRefundSchema = z.object({
  amount: z
    .string()
    .min(1, "Valor é obrigatório")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: "Valor deve ser maior que zero",
    }),
  justification: z
    .string()
    .min(1, "Justificativa é obrigatória")
    .refine((v) => v.trim().length > 0, {
      message: "Justificativa não pode estar em branco",
    }),
});

type RequestRefundFormData = z.infer<typeof requestRefundSchema>;

const executeRefundSchema = z
  .object({
    paymentMethod: z.enum(["PIX", "TED"]),
    bankName: z.string(),
    bankAgency: z.string(),
    bankAccount: z.string(),
    pixKey: z.string(),
    invoiceAction: z.enum(["CANCEL_INVOICE", "CREDIT_NOTE", "NONE"]),
    invoiceCancelReason: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.paymentMethod === "PIX" && !data.pixKey?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Chave PIX é obrigatória",
        path: ["pixKey"],
      });
    }
    if (data.paymentMethod === "TED") {
      if (!data.bankName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Banco é obrigatório",
          path: ["bankName"],
        });
      }
      if (!data.bankAgency?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Agência é obrigatória",
          path: ["bankAgency"],
        });
      }
      if (!data.bankAccount?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Conta é obrigatória",
          path: ["bankAccount"],
        });
      }
    }
    if (
      data.invoiceAction === "CANCEL_INVOICE" &&
      !data.invoiceCancelReason?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Motivo do cancelamento é obrigatório",
        path: ["invoiceCancelReason"],
      });
    }
  });

type ExecuteRefundFormData = z.infer<typeof executeRefundSchema>;

// ---------------------------------------------------------------------------
// RequestRefundDialog
// ---------------------------------------------------------------------------

interface RequestRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  companyId: string;
  boletoId?: string | null;
  onSuccess: () => void;
}

export function RequestRefundDialog({
  open,
  onOpenChange,
  ticketId,
  companyId,
  boletoId,
  onSuccess,
}: RequestRefundDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<RequestRefundFormData>({
    resolver: zodResolver(requestRefundSchema),
    defaultValues: { amount: "", justification: "" },
    mode: "onChange",
  });

  const [refundProofFile, setRefundProofFile] = useState<{ id: string; name: string } | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingRefund, setSubmittingRefund] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      reset({ amount: "", justification: "" });
      setRefundProofFile(null);
    }
  }, [open, reset]);

  async function handleUploadProof(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProof(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("companyId", companyId);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao fazer upload");
      }
      const data = await res.json();

      const attachment = await attachFileToTicket(ticketId, companyId, {
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        storagePath: data.storagePath,
      });

      setRefundProofFile({ id: attachment.id, name: data.fileName });
      toast.success("Arquivo enviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao fazer upload");
    } finally {
      setUploadingProof(false);
      e.target.value = "";
    }
  }

  async function onSubmitRefund(data: RequestRefundFormData) {
    if (!refundProofFile) return;
    setSubmittingRefund(true);
    try {
      await requestRefund(
        ticketId,
        companyId,
        parseFloat(data.amount),
        data.justification,
        refundProofFile.id,
        boletoId || undefined
      );
      toast.success("Reembolso solicitado com sucesso");
      onOpenChange(false);
      reset();
      setRefundProofFile(null);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao solicitar reembolso");
    } finally {
      setSubmittingRefund(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Solicitar Reembolso</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="refund-amount">Valor (R$) *</Label>
            <Input
              id="refund-amount"
              type="number"
              step="0.01"
              min="0.01"
              {...register("amount")}
              placeholder="0,00"
            />
            {errors.amount && (
              <p className="text-sm text-destructive mt-1">{errors.amount.message}</p>
            )}
          </div>

          {boletoId && (
            <div>
              <Label htmlFor="refund-boleto">Boleto Vinculado</Label>
              <Input
                id="refund-boleto"
                value={boletoId}
                disabled
                className="text-xs"
              />
            </div>
          )}

          <div>
            <Label>Comprovante de Pagamento *</Label>
            {refundProofFile ? (
              <div className="flex items-center gap-2 mt-1 rounded border p-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{refundProofFile.name}</span>
                <button
                  type="button"
                  onClick={() => setRefundProofFile(null)}
                  className="rounded p-0.5 hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="mt-1">
                <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                  {uploadingProof ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploadingProof ? "Enviando..." : "Clique para enviar comprovante"}
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.png,.jpg,.jpeg,.gif"
                    disabled={uploadingProof}
                    onChange={handleUploadProof}
                  />
                </label>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="refund-justification">Justificativa *</Label>
            <Textarea
              id="refund-justification"
              {...register("justification")}
              placeholder="Descreva o motivo do reembolso..."
              rows={3}
            />
            {errors.justification && (
              <p className="text-sm text-destructive mt-1">{errors.justification.message}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit(onSubmitRefund)}
            disabled={submittingRefund || !isValid || !refundProofFile}
          >
            {submittingRefund ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Solicitando...
              </>
            ) : (
              "Solicitar Reembolso"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ExecuteRefundDialog
// ---------------------------------------------------------------------------

interface ExecuteRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refundId: string;
  ticketId: string;
  companyId: string;
  onSuccess: () => void;
}

export function ExecuteRefundDialog({
  open,
  onOpenChange,
  refundId,
  ticketId,
  companyId,
  onSuccess,
}: ExecuteRefundDialogProps) {
  const defaultValues: ExecuteRefundFormData = {
    paymentMethod: "PIX",
    bankName: "",
    bankAgency: "",
    bankAccount: "",
    pixKey: "",
    invoiceAction: "NONE",
    invoiceCancelReason: "",
  };

  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    formState: { errors, isValid },
  } = useForm<ExecuteRefundFormData>({
    resolver: zodResolver(executeRefundSchema),
    defaultValues,
    mode: "onChange",
  });

  const paymentMethod = watch("paymentMethod");
  const invoiceAction = watch("invoiceAction");

  const [executeProofFile, setExecuteProofFile] = useState<{ id: string; name: string } | null>(null);
  const [uploadingExecuteProof, setUploadingExecuteProof] = useState(false);
  const [submittingExecute, setSubmittingExecute] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      reset(defaultValues);
      setExecuteProofFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  async function handleUploadProof(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingExecuteProof(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("companyId", companyId);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao fazer upload");
      }
      const data = await res.json();

      const attachment = await attachFileToTicket(ticketId, companyId, {
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        storagePath: data.storagePath,
      });

      setExecuteProofFile({ id: attachment.id, name: data.fileName });
      toast.success("Arquivo enviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao fazer upload");
    } finally {
      setUploadingExecuteProof(false);
      e.target.value = "";
    }
  }

  async function onSubmitExecute(data: ExecuteRefundFormData) {
    if (!refundId) return;
    setSubmittingExecute(true);
    try {
      await executeRefund(refundId, companyId, {
        paymentMethod: data.paymentMethod,
        bankName: data.bankName || undefined,
        bankAgency: data.bankAgency || undefined,
        bankAccount: data.bankAccount || undefined,
        pixKey: data.pixKey || undefined,
        invoiceAction: data.invoiceAction,
        invoiceCancelReason: data.invoiceCancelReason || undefined,
        refundProofId: executeProofFile?.id,
      });
      toast.success("Reembolso executado com sucesso");
      onOpenChange(false);
      reset(defaultValues);
      setExecuteProofFile(null);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao executar reembolso");
    } finally {
      setSubmittingExecute(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Executar Reembolso</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Metodo de Pagamento *</Label>
            <Controller
              control={control}
              name="paymentMethod"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PIX">PIX</SelectItem>
                    <SelectItem value="TED">TED</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {paymentMethod === "PIX" && (
            <div>
              <Label htmlFor="exec-pix-key">Chave PIX *</Label>
              <Input
                id="exec-pix-key"
                {...register("pixKey")}
                placeholder="CPF, CNPJ, email, telefone ou chave aleatória"
              />
              {errors.pixKey && (
                <p className="text-sm text-destructive mt-1">{errors.pixKey.message}</p>
              )}
            </div>
          )}

          {paymentMethod === "TED" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <Label htmlFor="exec-bank-name">Banco *</Label>
                <Input
                  id="exec-bank-name"
                  {...register("bankName")}
                  placeholder="Nome do banco"
                />
                {errors.bankName && (
                  <p className="text-sm text-destructive mt-1">{errors.bankName.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="exec-bank-agency">Agencia *</Label>
                <Input
                  id="exec-bank-agency"
                  {...register("bankAgency")}
                  placeholder="0000"
                />
                {errors.bankAgency && (
                  <p className="text-sm text-destructive mt-1">{errors.bankAgency.message}</p>
                )}
              </div>
              <div className="col-span-2">
                <Label htmlFor="exec-bank-account">Conta *</Label>
                <Input
                  id="exec-bank-account"
                  {...register("bankAccount")}
                  placeholder="00000-0"
                />
                {errors.bankAccount && (
                  <p className="text-sm text-destructive mt-1">{errors.bankAccount.message}</p>
                )}
              </div>
            </div>
          )}

          <div>
            <Label>Acao NFS-e</Label>
            <Controller
              control={control}
              name="invoiceAction"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Nenhuma</SelectItem>
                    <SelectItem value="CANCEL_INVOICE">Cancelar NFS-e</SelectItem>
                    <SelectItem value="CREDIT_NOTE">Emitir Nota de Credito</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {invoiceAction === "CANCEL_INVOICE" && (
            <div>
              <Label htmlFor="exec-cancel-reason">Motivo do Cancelamento *</Label>
              <Textarea
                id="exec-cancel-reason"
                {...register("invoiceCancelReason")}
                placeholder="Motivo do cancelamento da NFS-e..."
                rows={2}
              />
              {errors.invoiceCancelReason && (
                <p className="text-sm text-destructive mt-1">{errors.invoiceCancelReason.message}</p>
              )}
            </div>
          )}

          <div>
            <Label>Comprovante de Reembolso</Label>
            {executeProofFile ? (
              <div className="flex items-center gap-2 mt-1 rounded border p-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{executeProofFile.name}</span>
                <button
                  type="button"
                  onClick={() => setExecuteProofFile(null)}
                  className="rounded p-0.5 hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="mt-1">
                <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                  {uploadingExecuteProof ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploadingExecuteProof ? "Enviando..." : "Clique para enviar comprovante"}
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.png,.jpg,.jpeg,.gif"
                    disabled={uploadingExecuteProof}
                    onChange={handleUploadProof}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit(onSubmitExecute)}
            disabled={submittingExecute || !isValid}
          >
            {submittingExecute ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Executando...
              </>
            ) : (
              "Executar Reembolso"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
