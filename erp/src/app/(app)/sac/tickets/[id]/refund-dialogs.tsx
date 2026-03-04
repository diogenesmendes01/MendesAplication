"use client";

import { useState } from "react";
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
  const [refundForm, setRefundForm] = useState({
    amount: "",
    justification: "",
    boletoId: "",
  });
  const [refundProofFile, setRefundProofFile] = useState<{ id: string; name: string } | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingRefund, setSubmittingRefund] = useState(false);

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

  async function handleSubmitRefund() {
    if (!refundProofFile) return;
    setSubmittingRefund(true);
    try {
      await requestRefund(
        ticketId,
        companyId,
        parseFloat(refundForm.amount),
        refundForm.justification,
        refundProofFile.id,
        boletoId || undefined
      );
      toast.success("Reembolso solicitado com sucesso");
      onOpenChange(false);
      setRefundForm({ amount: "", justification: "", boletoId: "" });
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
              value={refundForm.amount}
              onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0,00"
            />
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
              <input
                type="hidden"
                value={boletoId}
                onChange={() => setRefundForm((f) => ({ ...f, boletoId: boletoId ?? "" }))}
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
              value={refundForm.justification}
              onChange={(e) => setRefundForm((f) => ({ ...f, justification: e.target.value }))}
              placeholder="Descreva o motivo do reembolso..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmitRefund}
            disabled={
              submittingRefund ||
              !refundForm.amount ||
              parseFloat(refundForm.amount) <= 0 ||
              !refundForm.justification.trim() ||
              !refundProofFile
            }
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
  const [executeForm, setExecuteForm] = useState({
    paymentMethod: "PIX" as "PIX" | "TED",
    bankName: "",
    bankAgency: "",
    bankAccount: "",
    pixKey: "",
    invoiceAction: "NONE" as "CANCEL_INVOICE" | "CREDIT_NOTE" | "NONE",
    invoiceCancelReason: "",
  });
  const [executeProofFile, setExecuteProofFile] = useState<{ id: string; name: string } | null>(null);
  const [uploadingExecuteProof, setUploadingExecuteProof] = useState(false);
  const [submittingExecute, setSubmittingExecute] = useState(false);

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

  async function handleExecuteRefund() {
    if (!refundId) return;
    setSubmittingExecute(true);
    try {
      await executeRefund(refundId, companyId, {
        paymentMethod: executeForm.paymentMethod,
        bankName: executeForm.bankName || undefined,
        bankAgency: executeForm.bankAgency || undefined,
        bankAccount: executeForm.bankAccount || undefined,
        pixKey: executeForm.pixKey || undefined,
        invoiceAction: executeForm.invoiceAction,
        invoiceCancelReason: executeForm.invoiceCancelReason || undefined,
        refundProofId: executeProofFile?.id,
      });
      toast.success("Reembolso executado com sucesso");
      onOpenChange(false);
      setExecuteForm({
        paymentMethod: "PIX",
        bankName: "",
        bankAgency: "",
        bankAccount: "",
        pixKey: "",
        invoiceAction: "NONE",
        invoiceCancelReason: "",
      });
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
            <Select
              value={executeForm.paymentMethod}
              onValueChange={(v) =>
                setExecuteForm((f) => ({ ...f, paymentMethod: v as "PIX" | "TED" }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PIX">PIX</SelectItem>
                <SelectItem value="TED">TED</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {executeForm.paymentMethod === "PIX" && (
            <div>
              <Label htmlFor="exec-pix-key">Chave PIX *</Label>
              <Input
                id="exec-pix-key"
                value={executeForm.pixKey}
                onChange={(e) => setExecuteForm((f) => ({ ...f, pixKey: e.target.value }))}
                placeholder="CPF, CNPJ, email, telefone ou chave aleatória"
              />
            </div>
          )}

          {executeForm.paymentMethod === "TED" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <Label htmlFor="exec-bank-name">Banco *</Label>
                <Input
                  id="exec-bank-name"
                  value={executeForm.bankName}
                  onChange={(e) => setExecuteForm((f) => ({ ...f, bankName: e.target.value }))}
                  placeholder="Nome do banco"
                />
              </div>
              <div>
                <Label htmlFor="exec-bank-agency">Agencia *</Label>
                <Input
                  id="exec-bank-agency"
                  value={executeForm.bankAgency}
                  onChange={(e) => setExecuteForm((f) => ({ ...f, bankAgency: e.target.value }))}
                  placeholder="0000"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="exec-bank-account">Conta *</Label>
                <Input
                  id="exec-bank-account"
                  value={executeForm.bankAccount}
                  onChange={(e) => setExecuteForm((f) => ({ ...f, bankAccount: e.target.value }))}
                  placeholder="00000-0"
                />
              </div>
            </div>
          )}

          <div>
            <Label>Acao NFS-e</Label>
            <Select
              value={executeForm.invoiceAction}
              onValueChange={(v) =>
                setExecuteForm((f) => ({
                  ...f,
                  invoiceAction: v as "CANCEL_INVOICE" | "CREDIT_NOTE" | "NONE",
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Nenhuma</SelectItem>
                <SelectItem value="CANCEL_INVOICE">Cancelar NFS-e</SelectItem>
                <SelectItem value="CREDIT_NOTE">Emitir Nota de Credito</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {executeForm.invoiceAction === "CANCEL_INVOICE" && (
            <div>
              <Label htmlFor="exec-cancel-reason">Motivo do Cancelamento *</Label>
              <Textarea
                id="exec-cancel-reason"
                value={executeForm.invoiceCancelReason}
                onChange={(e) => setExecuteForm((f) => ({ ...f, invoiceCancelReason: e.target.value }))}
                placeholder="Motivo do cancelamento da NFS-e..."
                rows={2}
              />
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
            onClick={handleExecuteRefund}
            disabled={
              submittingExecute ||
              (executeForm.paymentMethod === "PIX" && !executeForm.pixKey.trim()) ||
              (executeForm.paymentMethod === "TED" && (!executeForm.bankName.trim() || !executeForm.bankAgency.trim() || !executeForm.bankAccount.trim())) ||
              (executeForm.invoiceAction === "CANCEL_INVOICE" && !executeForm.invoiceCancelReason.trim())
            }
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
