"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, FileText, Mail, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "@/contexts/company-context";
import {
  getProposalById,
  listBoletosForProposal,
  generateBoletosForProposal,
  type ProposalDetail,
  type BoletoRow,
} from "../actions";
import {
  sendProposalEmail,
  sendBoletoEmail,
} from "@/lib/email-actions";
import { emitInvoiceForBoleto } from "@/lib/nfse-actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const currencyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function proposalStatusLabel(status: string) {
  switch (status) {
    case "DRAFT":
      return "Rascunho";
    case "SENT":
      return "Enviada";
    case "ACCEPTED":
      return "Aceita";
    case "REJECTED":
      return "Rejeitada";
    case "EXPIRED":
      return "Expirada";
    default:
      return status;
  }
}

function proposalStatusColor(status: string) {
  switch (status) {
    case "DRAFT":
      return "bg-gray-100 text-gray-800";
    case "SENT":
      return "bg-blue-100 text-blue-800";
    case "ACCEPTED":
      return "bg-green-100 text-green-800";
    case "REJECTED":
      return "bg-red-100 text-red-800";
    case "EXPIRED":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function boletoStatusLabel(status: string) {
  switch (status) {
    case "GENERATED":
      return "Gerado";
    case "SENT":
      return "Enviado";
    case "PAID":
      return "Pago";
    case "OVERDUE":
      return "Vencido";
    case "CANCELLED":
      return "Cancelado";
    default:
      return status;
  }
}

function boletoStatusColor(status: string) {
  switch (status) {
    case "GENERATED":
      return "bg-gray-100 text-gray-800";
    case "SENT":
      return "bg-blue-100 text-blue-800";
    case "PAID":
      return "bg-green-100 text-green-800";
    case "OVERDUE":
      return "bg-red-100 text-red-800";
    case "CANCELLED":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProposalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const proposalId = params.id as string;

  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [boletos, setBoletos] = useState<BoletoRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Generate boleto dialog
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [installments, setInstallments] = useState("1");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [generating, setGenerating] = useState(false);

  // Email sending state
  const [sendProposalDialogOpen, setSendProposalDialogOpen] = useState(false);
  const [sendingProposal, setSendingProposal] = useState(false);
  const [sendBoletoDialogOpen, setSendBoletoDialogOpen] = useState(false);
  const [selectedBoletoForEmail, setSelectedBoletoForEmail] =
    useState<BoletoRow | null>(null);
  const [sendingBoleto, setSendingBoleto] = useState(false);

  // NFS-e emission state
  const [emitNfseDialogOpen, setEmitNfseDialogOpen] = useState(false);
  const [selectedBoletoForNfse, setSelectedBoletoForNfse] =
    useState<BoletoRow | null>(null);
  const [emittingNfse, setEmittingNfse] = useState(false);

  // ---------------------------------------------------
  // Load proposal and boletos
  // ---------------------------------------------------

  const loadData = useCallback(async () => {
    if (!selectedCompanyId || !proposalId) return;
    setLoading(true);
    try {
      const [proposalData, boletosData] = await Promise.all([
        getProposalById(proposalId, selectedCompanyId),
        listBoletosForProposal(proposalId, selectedCompanyId),
      ]);
      setProposal(proposalData);
      setBoletos(boletosData);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar proposta"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, proposalId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---------------------------------------------------
  // Generate boletos
  // ---------------------------------------------------

  async function handleGenerateBoletos() {
    if (!selectedCompanyId || !proposalId) return;

    const numInstallments = parseInt(installments, 10);
    if (isNaN(numInstallments) || numInstallments < 1) {
      toast.error("Número de parcelas deve ser pelo menos 1");
      return;
    }
    if (numInstallments > 48) {
      toast.error("Número máximo de parcelas é 48");
      return;
    }
    if (!firstDueDate) {
      toast.error("Data do primeiro vencimento é obrigatória");
      return;
    }

    setGenerating(true);
    try {
      const result = await generateBoletosForProposal({
        proposalId,
        companyId: selectedCompanyId,
        installments: numInstallments,
        firstDueDate,
      });
      setBoletos(result.boletos);
      setGenerateDialogOpen(false);
      toast.success(
        `${result.boletos.length} boleto(s) gerado(s) com sucesso`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao gerar boletos"
      );
    } finally {
      setGenerating(false);
    }
  }

  // ---------------------------------------------------
  // Send proposal email
  // ---------------------------------------------------

  async function handleSendProposalEmail() {
    if (!selectedCompanyId || !proposalId) return;

    setSendingProposal(true);
    try {
      await sendProposalEmail(proposalId, selectedCompanyId);
      toast.success("Proposta enviada por e-mail com sucesso");
      setSendProposalDialogOpen(false);
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao enviar proposta por e-mail"
      );
    } finally {
      setSendingProposal(false);
    }
  }

  // ---------------------------------------------------
  // Send boleto email
  // ---------------------------------------------------

  function openSendBoletoDialog(boleto: BoletoRow) {
    setSelectedBoletoForEmail(boleto);
    setSendBoletoDialogOpen(true);
  }

  async function handleSendBoletoEmail() {
    if (!selectedCompanyId || !selectedBoletoForEmail) return;

    setSendingBoleto(true);
    try {
      await sendBoletoEmail(selectedBoletoForEmail.id, selectedCompanyId);
      toast.success("Boleto enviado por e-mail com sucesso");
      setSendBoletoDialogOpen(false);
      setSelectedBoletoForEmail(null);
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao enviar boleto por e-mail"
      );
    } finally {
      setSendingBoleto(false);
    }
  }

  // ---------------------------------------------------
  // Emit NFS-e
  // ---------------------------------------------------

  function openEmitNfseDialog(boleto: BoletoRow) {
    setSelectedBoletoForNfse(boleto);
    setEmitNfseDialogOpen(true);
  }

  async function handleEmitNfse() {
    if (!selectedCompanyId || !selectedBoletoForNfse) return;

    setEmittingNfse(true);
    try {
      const result = await emitInvoiceForBoleto(
        selectedBoletoForNfse.id,
        selectedCompanyId
      );
      toast.success(`NFS-e emitida com sucesso: ${result.nfNumber}`);
      setEmitNfseDialogOpen(false);
      setSelectedBoletoForNfse(null);
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao emitir NFS-e"
      );
    } finally {
      setEmittingNfse(false);
    }
  }

  // ---------------------------------------------------
  // No company selected
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar a proposta.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Proposta não encontrada.
        </div>
      </div>
    );
  }

  const canGenerateBoletos =
    proposal.status === "ACCEPTED" && boletos.length === 0;

  // Proposal can be emailed if DRAFT or SENT (DRAFT will transition to SENT)
  const canSendProposalEmail =
    (proposal.status === "DRAFT" || proposal.status === "SENT") &&
    !!proposal.clientEmail;

  const companyName = selectedCompany?.nomeFantasia || "Empresa";
  const proposalSubjectPreview = `Proposta Comercial #${proposal.id.slice(-6)} - ${companyName}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Proposta #{proposal.id.slice(-6)}
            </h1>
            <p className="text-sm text-muted-foreground">
              Cliente: {proposal.clientName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {canSendProposalEmail && (
            <Button
              variant="outline"
              onClick={() => setSendProposalDialogOpen(true)}
            >
              <Mail className="mr-2 h-4 w-4" />
              Enviar por E-mail
            </Button>
          )}
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${proposalStatusColor(proposal.status)}`}
          >
            {proposalStatusLabel(proposal.status)}
          </span>
        </div>
      </div>

      {/* Proposal info */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Informações da Proposta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Cliente</span>
              <span className="text-sm font-medium">
                {proposal.clientName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Valor Total</span>
              <span className="text-sm font-medium font-mono">
                {currencyFmt.format(parseFloat(proposal.totalValue))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Condições de Pagamento
              </span>
              <span className="text-sm font-medium">
                {proposal.paymentConditions || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Validade</span>
              <span className="text-sm font-medium">
                {proposal.validity
                  ? dateFmt.format(new Date(proposal.validity))
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Criada em</span>
              <span className="text-sm font-medium">
                {dateFmt.format(new Date(proposal.createdAt))}
              </span>
            </div>
            {proposal.observations && (
              <div>
                <span className="text-sm text-muted-foreground">
                  Observações
                </span>
                <p className="mt-1 text-sm">{proposal.observations}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Itens da Proposta</CardTitle>
            <CardDescription>
              {proposal.items.length} item(ns)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Preço Unit.</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposal.items.map((item) => {
                  const qty = parseFloat(item.quantity);
                  const price = parseFloat(item.unitPrice);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.description}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {qty}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {currencyFmt.format(price)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {currencyFmt.format(qty * price)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-bold">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-bold font-mono">
                    {currencyFmt.format(parseFloat(proposal.totalValue))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Boletos section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Boletos</CardTitle>
              <CardDescription>
                {boletos.length > 0
                  ? `${boletos.length} boleto(s) gerado(s)`
                  : "Nenhum boleto gerado para esta proposta"}
              </CardDescription>
            </div>
            {canGenerateBoletos && (
              <Button onClick={() => setGenerateDialogOpen(true)}>
                <FileText className="mr-2 h-4 w-4" />
                Gerar Boletos
              </Button>
            )}
          </div>
        </CardHeader>
        {boletos.length > 0 && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parcela</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boletos.map((boleto) => {
                  const canSendBoletoEmail =
                    (boleto.status === "GENERATED" || boleto.status === "SENT") &&
                    !!proposal.clientEmail;
                  return (
                    <TableRow key={boleto.id}>
                      <TableCell className="font-medium">
                        {boleto.installmentNumber}/{boletos.length}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {currencyFmt.format(parseFloat(boleto.value))}
                      </TableCell>
                      <TableCell>
                        {dateFmt.format(new Date(boleto.dueDate))}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${boletoStatusColor(boleto.status)}`}
                        >
                          {boletoStatusLabel(boleto.status)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {boleto.bankReference || "—"}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {canSendBoletoEmail && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openSendBoletoDialog(boleto)}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            Enviar
                          </Button>
                        )}
                        {boleto.status === "PAID" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEmitNfseDialog(boleto)}
                            title="Emitir NFS-e para este boleto"
                          >
                            <Receipt className="mr-1 h-4 w-4" />
                            Emitir NFS-e
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      {/* Generate Boletos Dialog */}
      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Boletos</DialogTitle>
            <DialogDescription>
              Configure as parcelas para gerar os boletos desta proposta. Valor
              total: {currencyFmt.format(parseFloat(proposal.totalValue))}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="installments">Número de Parcelas</Label>
              <Input
                id="installments"
                type="number"
                min="1"
                max="48"
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
              />
              {parseInt(installments, 10) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Valor por parcela:{" "}
                  {currencyFmt.format(
                    parseFloat(proposal.totalValue) /
                      parseInt(installments, 10)
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="firstDueDate">
                Primeiro Vencimento
              </Label>
              <Input
                id="firstDueDate"
                type="date"
                value={firstDueDate}
                onChange={(e) => setFirstDueDate(e.target.value)}
              />
              {parseInt(installments, 10) > 1 && firstDueDate && (
                <p className="text-xs text-muted-foreground">
                  Parcelas com vencimento mensal a partir de{" "}
                  {dateFmt.format(new Date(firstDueDate + "T12:00:00"))}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGenerateDialogOpen(false)}
              disabled={generating}
            >
              Cancelar
            </Button>
            <Button onClick={handleGenerateBoletos} disabled={generating}>
              {generating ? "Gerando..." : "Gerar Boletos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Proposal Email Confirmation Dialog */}
      <Dialog
        open={sendProposalDialogOpen}
        onOpenChange={setSendProposalDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Proposta por E-mail</DialogTitle>
            <DialogDescription>
              Confirme os dados antes de enviar a proposta por e-mail.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">
                Destinatário
              </span>
              <span className="text-sm font-medium">
                {proposal.clientEmail || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Assunto</span>
              <span className="text-sm font-medium">
                {proposalSubjectPreview}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Anexo</span>
              <span className="text-sm font-medium">
                Proposta_{proposal.id.slice(-6)}.txt
              </span>
            </div>
            {proposal.status === "DRAFT" && (
              <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                O status da proposta será atualizado para &quot;Enviada&quot; após o envio.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSendProposalDialogOpen(false)}
              disabled={sendingProposal}
            >
              Cancelar
            </Button>
            <Button onClick={handleSendProposalEmail} disabled={sendingProposal}>
              <Mail className="mr-2 h-4 w-4" />
              {sendingProposal ? "Enviando..." : "Enviar E-mail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Boleto Email Confirmation Dialog */}
      <Dialog
        open={sendBoletoDialogOpen}
        onOpenChange={(open) => {
          setSendBoletoDialogOpen(open);
          if (!open) setSelectedBoletoForEmail(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Boleto por E-mail</DialogTitle>
            <DialogDescription>
              Confirme os dados antes de enviar o boleto por e-mail.
            </DialogDescription>
          </DialogHeader>

          {selectedBoletoForEmail && (
            <div className="space-y-3 py-4">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  Destinatário
                </span>
                <span className="text-sm font-medium">
                  {proposal.clientEmail || "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Assunto</span>
                <span className="text-sm font-medium">
                  Boleto - Parcela{" "}
                  {selectedBoletoForEmail.installmentNumber}/{boletos.length} -{" "}
                  {companyName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Valor</span>
                <span className="text-sm font-medium font-mono">
                  {currencyFmt.format(
                    parseFloat(selectedBoletoForEmail.value)
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  Vencimento
                </span>
                <span className="text-sm font-medium">
                  {dateFmt.format(
                    new Date(selectedBoletoForEmail.dueDate)
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Anexo</span>
                <span className="text-sm font-medium">
                  Boleto_{selectedBoletoForEmail.bankReference || selectedBoletoForEmail.id.slice(-6)}.txt
                </span>
              </div>
              {selectedBoletoForEmail.status === "GENERATED" && (
                <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                  O status do boleto será atualizado para &quot;Enviado&quot; após o envio.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSendBoletoDialogOpen(false);
                setSelectedBoletoForEmail(null);
              }}
              disabled={sendingBoleto}
            >
              Cancelar
            </Button>
            <Button onClick={handleSendBoletoEmail} disabled={sendingBoleto}>
              <Mail className="mr-2 h-4 w-4" />
              {sendingBoleto ? "Enviando..." : "Enviar E-mail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Emit NFS-e Confirmation Dialog */}
      <Dialog
        open={emitNfseDialogOpen}
        onOpenChange={(open) => {
          setEmitNfseDialogOpen(open);
          if (!open) setSelectedBoletoForNfse(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Emitir NFS-e</DialogTitle>
            <DialogDescription>
              Confirme a emissão da Nota Fiscal de Serviço Eletrônica para este boleto pago.
            </DialogDescription>
          </DialogHeader>

          {selectedBoletoForNfse && (
            <div className="space-y-3 py-4">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Cliente</span>
                <span className="text-sm font-medium">
                  {proposal.clientName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Valor</span>
                <span className="text-sm font-medium font-mono">
                  {currencyFmt.format(parseFloat(selectedBoletoForNfse.value))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Parcela</span>
                <span className="text-sm font-medium">
                  {selectedBoletoForNfse.installmentNumber}/{boletos.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  Alíquota ISS
                </span>
                <span className="text-sm font-medium">5,00%</span>
              </div>
              <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                A NFS-e será emitida automaticamente e enviada por e-mail ao
                cliente.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEmitNfseDialogOpen(false);
                setSelectedBoletoForNfse(null);
              }}
              disabled={emittingNfse}
            >
              Cancelar
            </Button>
            <Button onClick={handleEmitNfse} disabled={emittingNfse}>
              <Receipt className="mr-2 h-4 w-4" />
              {emittingNfse ? "Emitindo..." : "Emitir NFS-e"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
