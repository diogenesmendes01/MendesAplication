"use client";



import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileText,
  Mail,
  Receipt,
  CheckCircle2,
  Send,
  FileCheck,
  AlertCircle,
  Clock,
  Info,
} from "lucide-react";
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
import { ProposalStepper } from "@/components/proposal-stepper";
import {
  getProposalById,
  listBoletosForProposal,
  generateBoletosForProposal,
  listProposalEvents,
  updateProposalStatus,
  type ProposalDetail,
  type BoletoRow,
  type ProposalEventRow,
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
    case "DRAFT": return "Rascunho";
    case "SENT": return "Enviada";
    case "ACCEPTED": return "Aceita";
    case "REJECTED": return "Rejeitada";
    case "EXPIRED": return "Expirada";
    default: return status;
  }
}

function proposalStatusColor(status: string) {
  switch (status) {
    case "DRAFT": return "bg-background-subtle text-text-secondary";
    case "SENT": return "bg-info-subtle text-info";
    case "ACCEPTED": return "bg-success-subtle text-success";
    case "REJECTED": return "bg-danger-subtle text-danger";
    case "EXPIRED": return "bg-warning-subtle text-warning";
    default: return "bg-background-subtle text-text-secondary";
  }
}

function boletoStatusLabel(status: string) {
  switch (status) {
    case "GENERATED": return "Gerado";
    case "SENT": return "Enviado";
    case "PAID": return "Pago";
    case "OVERDUE": return "Vencido";
    case "CANCELLED": return "Cancelado";
    default: return status;
  }
}

function boletoStatusColor(status: string) {
  switch (status) {
    case "GENERATED": return "bg-background-subtle text-text-secondary";
    case "SENT": return "bg-info-subtle text-info";
    case "PAID": return "bg-success-subtle text-success";
    case "OVERDUE": return "bg-danger-subtle text-danger";
    case "CANCELLED": return "bg-warning-subtle text-warning";
    default: return "bg-background-subtle text-text-secondary";
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
  const [events, setEvents] = useState<ProposalEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [installments, setInstallments] = useState("1");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sendProposalDialogOpen, setSendProposalDialogOpen] = useState(false);
  const [sendingProposal, setSendingProposal] = useState(false);
  const [sendBoletoDialogOpen, setSendBoletoDialogOpen] = useState(false);
  const [selectedBoletoForEmail, setSelectedBoletoForEmail] = useState<BoletoRow | null>(null);
  const [sendingBoleto, setSendingBoleto] = useState(false);
  const [emitNfseDialogOpen, setEmitNfseDialogOpen] = useState(false);
  const [selectedBoletoForNfse, setSelectedBoletoForNfse] = useState<BoletoRow | null>(null);
  const [emittingNfse, setEmittingNfse] = useState(false);
  const [acceptingProposal, setAcceptingProposal] = useState(false);

  // Load data
  const loadData = useCallback(async () => {
    if (!selectedCompanyId || !proposalId) return;
    setLoading(true);
    try {
      const [proposalData, boletosData, eventsData] = await Promise.all([
        getProposalById(proposalId, selectedCompanyId),
        listBoletosForProposal(proposalId, selectedCompanyId),
        listProposalEvents(proposalId, selectedCompanyId),
      ]);
      setProposal(proposalData);
      setBoletos(boletosData);
      setEvents(eventsData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar proposta");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, proposalId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Actions
  async function handleGenerateBoletos() {
    if (!selectedCompanyId || !proposalId) return;
    const numInstallments = parseInt(installments, 10);
    if (isNaN(numInstallments) || numInstallments < 1) { toast.error("Número de parcelas deve ser pelo menos 1"); return; }
    if (numInstallments > 48) { toast.error("Número máximo de parcelas é 48"); return; }
    if (!firstDueDate) { toast.error("Data do primeiro vencimento é obrigatória"); return; }

    setGenerating(true);
    try {
      const result = await generateBoletosForProposal({ proposalId, companyId: selectedCompanyId, installments: numInstallments, firstDueDate });
      setBoletos(result.boletos);
      setGenerateDialogOpen(false);
      toast.success(`${result.boletos.length} boleto(s) gerado(s) com sucesso`);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar boletos");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSendProposalEmail() {
    if (!selectedCompanyId || !proposalId) return;
    setSendingProposal(true);
    try {
      await sendProposalEmail(proposalId, selectedCompanyId);
      toast.success("Proposta enviada por e-mail com sucesso");
      setSendProposalDialogOpen(false);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar proposta por e-mail");
    } finally {
      setSendingProposal(false);
    }
  }

  async function handleAcceptProposal() {
    if (!selectedCompanyId || !proposalId) return;
    setAcceptingProposal(true);
    try {
      await updateProposalStatus(proposalId, "ACCEPTED" as const, selectedCompanyId);
      toast.success("Aceite registrado com sucesso");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar aceite");
    } finally {
      setAcceptingProposal(false);
    }
  }

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
      toast.error(err instanceof Error ? err.message : "Erro ao enviar boleto por e-mail");
    } finally {
      setSendingBoleto(false);
    }
  }

  function openEmitNfseDialog(boleto: BoletoRow) {
    setSelectedBoletoForNfse(boleto);
    setEmitNfseDialogOpen(true);
  }

  async function handleEmitNfse() {
    if (!selectedCompanyId || !selectedBoletoForNfse) return;
    setEmittingNfse(true);
    try {
      const result = await emitInvoiceForBoleto(selectedBoletoForNfse.id, selectedCompanyId);
      toast.success(`NFS-e emitida com sucesso: ${result.nfNumber}`);
      setEmitNfseDialogOpen(false);
      setSelectedBoletoForNfse(null);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao emitir NFS-e");
    } finally {
      setEmittingNfse(false);
    }
  }

  // No company
  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-text-secondary">
        Selecione uma empresa para visualizar a proposta.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-text-secondary">
        Carregando...
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
        <div className="flex h-64 items-center justify-center text-text-secondary">
          Proposta não encontrada.
        </div>
      </div>
    );
  }

  // Determine stepper state
  const hasBoletos = boletos.length > 0;
  const hasBoletoPaid = boletos.some((b) => b.status === "PAID");
  const hasNfseIssued = events.some((e) => e.type === "NFSE_EMITTED");
  const hasBoletoSent = boletos.some((b) => b.status === "SENT" || b.status === "PAID");
  const allBoletosPaid = hasBoletos && boletos.every((b) => b.status === "PAID");
  const hasGeneratedBoleto = boletos.some((b) => b.status === "GENERATED");
  const canGenerateBoletos = proposal.status === "ACCEPTED" && boletos.length === 0;
  const companyName = selectedCompany?.nomeFantasia || "Empresa";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-1 duration-300">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Button>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-text-primary">
              Proposta #{proposal.id.slice(-6)}
            </h1>
            <p className="text-body-sm text-text-secondary">
              Cliente: {proposal.clientName}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${proposalStatusColor(proposal.status)}`}>
          {proposalStatusLabel(proposal.status)}
        </span>
      </div>

      {/* ── Stepper ── */}
      <Card className="hover:shadow-sm">
        <CardContent className="py-5">
          <ProposalStepper
            proposalStatus={proposal.status}
            hasBoletos={hasBoletos}
            hasBoletoPaid={hasBoletoPaid}
            hasNfseIssued={hasNfseIssued}
          />
        </CardContent>
      </Card>

      {/* ── Contextual Actions ── */}
      <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="text-caption font-semibold text-text-tertiary uppercase tracking-wider mb-3">
          Próxima ação
        </div>

        {/* DRAFT → Send email */}
        {proposal.status === "DRAFT" && (
          <Button
            onClick={() => setSendProposalDialogOpen(true)}
            disabled={!proposal.clientEmail}
          >
            <Mail className="mr-2 h-4 w-4" />
            Enviar Proposta por E-mail
          </Button>
        )}

        {/* SENT → Accept + Resend */}
        {proposal.status === "SENT" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleAcceptProposal} disabled={acceptingProposal}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {acceptingProposal ? "Registrando..." : "Registrar Aceite"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setSendProposalDialogOpen(true)}
              disabled={!proposal.clientEmail}
            >
              <Mail className="mr-2 h-4 w-4" />
              Reenviar E-mail
            </Button>
          </div>
        )}

        {/* ACCEPTED, no boletos → Generate */}
        {canGenerateBoletos && (
          <Button onClick={() => setGenerateDialogOpen(true)}>
            <FileText className="mr-2 h-4 w-4" />
            Gerar Boletos
          </Button>
        )}

        {/* Boleto GENERATED → Send boleto email */}
        {proposal.status === "ACCEPTED" && hasGeneratedBoleto && !hasBoletoSent && (
          <div className="flex flex-wrap gap-2">
            {boletos
              .filter((b) => b.status === "GENERATED")
              .map((b) => (
                <Button key={b.id} variant="outline" onClick={() => openSendBoletoDialog(b)}>
                  <Mail className="mr-2 h-4 w-4" />
                  Enviar Boleto {b.installmentNumber}/{boletos.length}
                </Button>
              ))}
          </div>
        )}

        {/* Boleto SENT → Waiting */}
        {proposal.status === "ACCEPTED" && hasBoletoSent && !allBoletosPaid && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-info-subtle px-3 py-2 text-body-sm text-info">
              <Info className="h-4 w-4" />
              Aguardando pagamento
            </div>
            {boletos.filter((b) => b.status === "SENT").map((b) => (
              <Button key={b.id} variant="outline" size="sm" onClick={() => openSendBoletoDialog(b)}>
                Reenviar {b.installmentNumber}/{boletos.length}
              </Button>
            ))}
          </div>
        )}

        {/* Boleto PAID → Emit NFS-e */}
        {proposal.status === "ACCEPTED" && hasBoletoPaid && !hasNfseIssued && (
          <div className="flex flex-wrap gap-2">
            {boletos
              .filter((b) => b.status === "PAID")
              .map((b) => (
                <Button key={b.id} onClick={() => openEmitNfseDialog(b)}>
                  <Receipt className="mr-2 h-4 w-4" />
                  Emitir NFS-e — Parcela {b.installmentNumber}/{boletos.length}
                </Button>
              ))}
          </div>
        )}

        {/* All done */}
        {hasNfseIssued && (
          <div className="flex items-center gap-2 rounded-lg bg-success-subtle px-3 py-2 text-body-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            Fluxo concluído — NFS-e emitida
          </div>
        )}

        {/* Cancelled/Rejected/Expired */}
        {["CANCELLED", "REJECTED", "EXPIRED"].includes(proposal.status) && (
          <div className="flex items-center gap-2 rounded-lg bg-background-subtle px-3 py-2 text-body-sm text-text-secondary">
            <Info className="h-4 w-4" />
            Proposta {proposalStatusLabel(proposal.status).toLowerCase()} — nenhuma ação disponível.
          </div>
        )}
      </div>

      {/* ── Proposal info ── */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">Informações da Proposta</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Cliente</span><span className="text-body-sm font-medium">{proposal.clientName}</span></div>
            <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Valor Total</span><span className="text-body-sm font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{currencyFmt.format(parseFloat(proposal.totalValue))}</span></div>
            <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Condições de Pagamento</span><span className="text-body-sm font-medium">{proposal.paymentConditions || "—"}</span></div>
            <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Validade</span><span className="text-body-sm font-medium">{proposal.validity ? dateFmt.format(new Date(proposal.validity)) : "—"}</span></div>
            <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Criada em</span><span className="text-body-sm font-medium">{dateFmt.format(new Date(proposal.createdAt))}</span></div>
            {proposal.observations && (
              <div><span className="text-body-sm text-text-secondary">Observações</span><p className="mt-1 text-body-sm">{proposal.observations}</p></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Itens da Proposta</CardTitle>
            <CardDescription>{proposal.items.length} item(ns)</CardDescription>
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
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{qty}</TableCell>
                      <TableCell className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{currencyFmt.format(price)}</TableCell>
                      <TableCell className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{currencyFmt.format(qty * price)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-bold">Total</TableCell>
                  <TableCell className="text-right font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{currencyFmt.format(parseFloat(proposal.totalValue))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ── Boletos section ── */}
      {boletos.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Boletos</CardTitle>
                <CardDescription>{boletos.length} boleto(s) gerado(s)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parcela</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Referência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boletos.map((boleto) => (
                  <TableRow key={boleto.id}>
                    <TableCell className="font-medium">{boleto.installmentNumber}/{boletos.length}</TableCell>
                    <TableCell className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{currencyFmt.format(parseFloat(boleto.value))}</TableCell>
                    <TableCell>{dateFmt.format(new Date(boleto.dueDate))}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${boletoStatusColor(boleto.status)}`}>
                        {boletoStatusLabel(boleto.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-text-tertiary" style={{ fontVariantNumeric: "tabular-nums" }}>{boleto.bankReference || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Activity Log ── */}
      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-text-tertiary" />
              Histórico de atividades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative border-l border-border-subtle ml-3 space-y-4">
              {events.map((evt) => (
                <li key={evt.id} className="ml-4">
                  <div className="absolute -left-[7px] mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-border flex items-center justify-center">
                    {evt.type === "CREATED" && <CheckCircle2 className="h-2 w-2 text-success" />}
                    {evt.type === "EMAIL_SENT" && <Send className="h-2 w-2 text-info" />}
                    {evt.type === "BOLETO_GENERATED" && <FileText className="h-2 w-2 text-accent" />}
                    {evt.type === "BOLETO_SENT" && <Send className="h-2 w-2 text-accent" />}
                    {evt.type === "PAID" && <CheckCircle2 className="h-2 w-2 text-success" />}
                    {evt.type === "NFSE_EMITTED" && <FileCheck className="h-2 w-2 text-success" />}
                    {evt.type === "STATUS_CHANGED" && <AlertCircle className="h-2 w-2 text-warning" />}
                  </div>
                  <div className="pl-1">
                    <p className="text-body-sm text-text-primary leading-snug">{evt.description}</p>
                    <time className="text-caption text-text-tertiary">
                      {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(evt.createdAt))}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* ══════════════ Dialogs ══════════════ */}

      {/* Generate Boletos */}
      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Boletos</DialogTitle>
            <DialogDescription>
              Configure as parcelas. Valor total: {currencyFmt.format(parseFloat(proposal.totalValue))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="installments">Número de Parcelas</Label>
              <Input id="installments" type="number" min="1" max="48" value={installments} onChange={(e) => setInstallments(e.target.value)} />
              {parseInt(installments, 10) > 0 && (
                <p className="text-caption text-text-tertiary">Valor por parcela: {currencyFmt.format(parseFloat(proposal.totalValue) / parseInt(installments, 10))}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstDueDate">Primeiro Vencimento</Label>
              <Input id="firstDueDate" type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
              {parseInt(installments, 10) > 1 && firstDueDate && (
                <p className="text-caption text-text-tertiary">Parcelas com vencimento mensal a partir de {dateFmt.format(new Date(firstDueDate + "T12:00:00"))}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateDialogOpen(false)} disabled={generating}>Cancelar</Button>
            <Button onClick={handleGenerateBoletos} disabled={generating}>{generating ? "Gerando..." : "Gerar Boletos"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Proposal Email */}
      <Dialog open={sendProposalDialogOpen} onOpenChange={setSendProposalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Proposta por E-mail</DialogTitle>
            <DialogDescription>Confirme os dados antes de enviar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Destinatário</span><span className="text-body-sm font-medium">{proposal.clientEmail || "—"}</span></div>
            <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Assunto</span><span className="text-body-sm font-medium">Proposta Comercial #{proposal.id.slice(-6)} - {companyName}</span></div>
            {proposal.status === "DRAFT" && (
              <p className="text-caption text-info bg-info-subtle p-2 rounded">O status será atualizado para &quot;Enviada&quot; após o envio.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendProposalDialogOpen(false)} disabled={sendingProposal}>Cancelar</Button>
            <Button onClick={handleSendProposalEmail} disabled={sendingProposal}>
              <Mail className="mr-2 h-4 w-4" />{sendingProposal ? "Enviando..." : "Enviar E-mail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Boleto Email */}
      <Dialog open={sendBoletoDialogOpen} onOpenChange={(open) => { setSendBoletoDialogOpen(open); if (!open) setSelectedBoletoForEmail(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Boleto por E-mail</DialogTitle>
            <DialogDescription>Confirme os dados antes de enviar.</DialogDescription>
          </DialogHeader>
          {selectedBoletoForEmail && (
            <div className="space-y-3 py-4">
              <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Destinatário</span><span className="text-body-sm font-medium">{proposal.clientEmail || "—"}</span></div>
              <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Valor</span><span className="text-body-sm font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{currencyFmt.format(parseFloat(selectedBoletoForEmail.value))}</span></div>
              <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Vencimento</span><span className="text-body-sm font-medium">{dateFmt.format(new Date(selectedBoletoForEmail.dueDate))}</span></div>
              {selectedBoletoForEmail.status === "GENERATED" && (
                <p className="text-caption text-info bg-info-subtle p-2 rounded">O status do boleto será atualizado para &quot;Enviado&quot; após o envio.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSendBoletoDialogOpen(false); setSelectedBoletoForEmail(null); }} disabled={sendingBoleto}>Cancelar</Button>
            <Button onClick={handleSendBoletoEmail} disabled={sendingBoleto}>
              <Mail className="mr-2 h-4 w-4" />{sendingBoleto ? "Enviando..." : "Enviar E-mail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Emit NFS-e */}
      <Dialog open={emitNfseDialogOpen} onOpenChange={(open) => { setEmitNfseDialogOpen(open); if (!open) setSelectedBoletoForNfse(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Emitir NFS-e</DialogTitle>
            <DialogDescription>Confirme a emissão da Nota Fiscal de Serviço Eletrônica.</DialogDescription>
          </DialogHeader>
          {selectedBoletoForNfse && (
            <div className="space-y-3 py-4">
              <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Cliente</span><span className="text-body-sm font-medium">{proposal.clientName}</span></div>
              <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Valor</span><span className="text-body-sm font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{currencyFmt.format(parseFloat(selectedBoletoForNfse.value))}</span></div>
              <div className="flex justify-between"><span className="text-body-sm text-text-secondary">Parcela</span><span className="text-body-sm font-medium">{selectedBoletoForNfse.installmentNumber}/{boletos.length}</span></div>
              <p className="text-caption text-info bg-info-subtle p-2 rounded">A NFS-e será emitida e enviada automaticamente por e-mail ao cliente.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEmitNfseDialogOpen(false); setSelectedBoletoForNfse(null); }} disabled={emittingNfse}>Cancelar</Button>
            <Button onClick={handleEmitNfse} disabled={emittingNfse}>
              <Receipt className="mr-2 h-4 w-4" />{emittingNfse ? "Emitindo..." : "Emitir NFS-e"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
