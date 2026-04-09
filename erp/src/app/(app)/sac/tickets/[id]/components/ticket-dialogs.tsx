"use client";

import { useState, useCallback, forwardRef, useImperativeHandle } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  FileDown,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  getTicketRefunds,
  rejectRefund,
  searchClientsForLink,
  linkContactToClient,
  createClientAndLink,
  getCancellationInfo,
  listTimelineEvents,
  type TicketDetail,
  type ClientForLink,
  type RefundSummary,
  type CancellationInfo,
} from "../../actions";
import { generateTicketPdf } from "@/lib/ticket-pdf";
import RaModerationDialog from "../ra-moderation-dialog";

const RequestRefundDialog = dynamic(
  () =>
    import("../refund-dialogs").then((m) => ({
      default: m.RequestRefundDialog,
    })),
  { ssr: false }
);
const ExecuteRefundDialog = dynamic(
  () =>
    import("../refund-dialogs").then((m) => ({
      default: m.ExecuteRefundDialog,
    })),
  { ssr: false }
);
const CancellationDialog = dynamic(
  () =>
    import("../cancellation-dialog").then((m) => ({
      default: m.CancellationDialog,
    })),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Public handle — methods exposed to the parent via ref
// ---------------------------------------------------------------------------

export interface TicketDialogsHandle {
  openExportDialog: () => void;
  openLinkDialog: () => void;
  openCreateClientDialog: (prefill?: { email?: string; telefone?: string }) => void;
  openRequestRefund: () => void;
  openRejectRefund: (refundId: string) => void;
  openExecuteRefund: (refundId: string) => void;
  openCancelDialog: () => void;
  openRaModeration: () => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TicketDialogsProps {
  ticket: TicketDetail;
  companyId: string;
  refunds: RefundSummary[];
  onTicketUpdated: () => void;
  onRefundsChange: (refunds: RefundSummary[]) => void;
  onCancellationChange: (cancellation: CancellationInfo | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TicketDialogs = forwardRef<TicketDialogsHandle, TicketDialogsProps>(
  function TicketDialogs(
    { ticket, companyId, refunds, onTicketUpdated, onRefundsChange, onCancellationChange },
    ref
  ) {
    // ── Export PDF state ──────────────────────────────────────────
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [exportIncludeNotes, setExportIncludeNotes] = useState(true);
    const [exportIncludeAttachments, setExportIncludeAttachments] = useState(true);
    const [exporting, setExporting] = useState(false);

    // ── Link client state (US-081) ───────────────────────────────
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [linkSearch, setLinkSearch] = useState("");
    const [linkResults, setLinkResults] = useState<ClientForLink[]>([]);
    const [linkSearching, setLinkSearching] = useState(false);
    const [linking, setLinking] = useState(false);

    // ── Create client state (US-081) ─────────────────────────────
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [newClientForm, setNewClientForm] = useState({
      name: "",
      cpfCnpj: "",
      type: "PJ" as "PF" | "PJ",
      email: "",
      telefone: "",
      razaoSocial: "",
      endereco: "",
    });

    // ── Request Refund state (US-085) ────────────────────────────
    const [requestRefundOpen, setRequestRefundOpen] = useState(false);

    // ── Reject Refund state (US-085) ─────────────────────────────
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [rejectRefundId, setRejectRefundId] = useState("");
    const [rejectReason, setRejectReason] = useState("");
    const [submittingReject, setSubmittingReject] = useState(false);

    // ── Execute Refund state (US-085) ────────────────────────────
    const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
    const [executeRefundId, setExecuteRefundId] = useState("");

    // ── Cancellation state (US-086) ──────────────────────────────
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

    // ── RA Moderation state ──────────────────────────────────────
    const [raModerationOpen, setRaModerationOpen] = useState(false);

    // ─────────────────────────────────────────────────────────────
    // Imperative handle
    // ─────────────────────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
      openExportDialog: () => setExportDialogOpen(true),
      openLinkDialog: () => setLinkDialogOpen(true),
      openCreateClientDialog: (prefill) => {
        if (prefill) {
          setNewClientForm((prev) => ({
            ...prev,
            email: prefill.email ?? "",
            telefone: prefill.telefone ?? "",
          }));
        }
        setCreateDialogOpen(true);
      },
      openRequestRefund: () => setRequestRefundOpen(true),
      openRejectRefund: (refundId: string) => {
        setRejectRefundId(refundId);
        setRejectDialogOpen(true);
      },
      openExecuteRefund: (refundId: string) => {
        setExecuteRefundId(refundId);
        setExecuteDialogOpen(true);
      },
      openCancelDialog: () => setCancelDialogOpen(true),
      openRaModeration: () => setRaModerationOpen(true),
    }));

    // ─────────────────────────────────────────────────────────────
    // Handlers
    // ─────────────────────────────────────────────────────────────

    // Export PDF (US-089)
    async function handleExportPdf() {
      if (!companyId || !ticket) return;
      setExporting(true);
      try {
        const events = await listTimelineEvents(ticket.id, companyId);
        await generateTicketPdf({
          ticket,
          events,
          refunds,
          includeInternalNotes: exportIncludeNotes,
          includeAttachmentList: exportIncludeAttachments,
        });
        toast.success("PDF exportado com sucesso");
        setExportDialogOpen(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Erro ao exportar PDF"
        );
      } finally {
        setExporting(false);
      }
    }

    // Link search (US-081)
    const handleLinkSearch = useCallback(
      async (query: string) => {
        setLinkSearch(query);
        if (!companyId || query.trim().length < 2) {
          setLinkResults([]);
          return;
        }
        setLinkSearching(true);
        try {
          const results = await searchClientsForLink(companyId, query);
          setLinkResults(results);
        } catch {
          setLinkResults([]);
        } finally {
          setLinkSearching(false);
        }
      },
      [companyId]
    );

    // Link to existing client (US-081)
    async function handleLinkToClient(clientId: string) {
      if (!companyId || !ticket) return;
      setLinking(true);
      try {
        const result = await linkContactToClient(
          ticket.id,
          companyId,
          clientId
        );
        toast.success(`Ticket vinculado ao cliente ${result.clientName}`);
        setLinkDialogOpen(false);
        setLinkSearch("");
        setLinkResults([]);
        onTicketUpdated();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Erro ao vincular cliente"
        );
      } finally {
        setLinking(false);
      }
    }

    // Create and link client (US-081)
    async function handleCreateAndLink() {
      if (!companyId || !ticket) return;
      setLinking(true);
      try {
        const result = await createClientAndLink(ticket.id, companyId, {
          name: newClientForm.name,
          cpfCnpj: newClientForm.cpfCnpj,
          type: newClientForm.type,
          email: newClientForm.email || undefined,
          telefone: newClientForm.telefone || undefined,
          razaoSocial: newClientForm.razaoSocial || undefined,
          endereco: newClientForm.endereco || undefined,
        });
        toast.success(`Cliente ${result.clientName} criado e vinculado`);
        setCreateDialogOpen(false);
        setNewClientForm({
          name: "",
          cpfCnpj: "",
          type: "PJ",
          email: "",
          telefone: "",
          razaoSocial: "",
          endereco: "",
        });
        onTicketUpdated();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Erro ao criar cliente"
        );
      } finally {
        setLinking(false);
      }
    }

    // Reject refund (US-085)
    async function handleRejectRefund() {
      if (!companyId || !rejectRefundId) return;
      setSubmittingReject(true);
      try {
        await rejectRefund(rejectRefundId, companyId, rejectReason);
        toast.success("Reembolso rejeitado");
        setRejectDialogOpen(false);
        setRejectRefundId("");
        setRejectReason("");
        getTicketRefunds(ticket.id, companyId)
          .then(onRefundsChange)
          .catch(() => {});
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Erro ao rejeitar reembolso"
        );
      } finally {
        setSubmittingReject(false);
      }
    }

    // Refund success helper
    function handleRefundSuccess() {
      getTicketRefunds(ticket.id, companyId)
        .then(onRefundsChange)
        .catch(() => {});
      onTicketUpdated();
    }

    // Cancellation success helper
    function handleCancellationSuccess() {
      getCancellationInfo(ticket.id, companyId)
        .then(onCancellationChange)
        .catch(() => {});
      onTicketUpdated();
    }

    // ─────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────

    return (
      <>
        {/* Export PDF dialog (US-089) */}
        <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Exportar Ticket como PDF</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="export-notes"
                  checked={exportIncludeNotes}
                  onCheckedChange={(c) => setExportIncludeNotes(c === true)}
                />
                <Label
                  htmlFor="export-notes"
                  className="text-sm font-normal cursor-pointer"
                >
                  Incluir notas internas
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="export-attachments"
                  checked={exportIncludeAttachments}
                  onCheckedChange={(c) =>
                    setExportIncludeAttachments(c === true)
                  }
                />
                <Label
                  htmlFor="export-attachments"
                  className="text-sm font-normal cursor-pointer"
                >
                  Incluir lista de anexos
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setExportDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button onClick={handleExportPdf} disabled={exporting}>
                {exporting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="mr-1.5 h-3.5 w-3.5" />
                )}
                {exporting ? "Exportando..." : "Exportar PDF"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Link to existing client dialog (US-081) */}
        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Vincular a Cliente Existente</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou CNPJ/CPF..."
                  value={linkSearch}
                  onChange={(e) => handleLinkSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {linkSearching && (
                <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Buscando...
                </div>
              )}
              {!linkSearching &&
                linkSearch.length >= 2 &&
                linkResults.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Nenhum cliente encontrado
                  </p>
                )}
              {linkResults.length > 0 && (
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {linkResults.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      disabled={linking}
                      onClick={() => handleLinkToClient(client.id)}
                      className="w-full rounded-md border p-3 text-left hover:bg-muted transition-colors"
                    >
                      <p className="text-sm font-medium">{client.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {client.cpfCnpj}
                        {client.email && ` · ${client.email}`}
                        {client.telefone && ` · ${client.telefone}`}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Create new client dialog (US-081) */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Criar Novo Cliente e Vincular</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label htmlFor="new-client-name">Nome *</Label>
                  <Input
                    id="new-client-name"
                    value={newClientForm.name}
                    onChange={(e) =>
                      setNewClientForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="Nome do cliente"
                  />
                </div>
                <div>
                  <Label htmlFor="new-client-type">Tipo *</Label>
                  <Select
                    value={newClientForm.type}
                    onValueChange={(v) =>
                      setNewClientForm((f) => ({
                        ...f,
                        type: v as "PF" | "PJ",
                      }))
                    }
                  >
                    <SelectTrigger id="new-client-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PJ">Pessoa Juridica</SelectItem>
                      <SelectItem value="PF">Pessoa Fisica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="new-client-cpfcnpj">
                    {newClientForm.type === "PF" ? "CPF" : "CNPJ"} *
                  </Label>
                  <Input
                    id="new-client-cpfcnpj"
                    value={newClientForm.cpfCnpj}
                    onChange={(e) =>
                      setNewClientForm((f) => ({
                        ...f,
                        cpfCnpj: e.target.value,
                      }))
                    }
                    placeholder={
                      newClientForm.type === "PF"
                        ? "000.000.000-00"
                        : "00.000.000/0000-00"
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="new-client-email">Email</Label>
                  <Input
                    id="new-client-email"
                    type="email"
                    value={newClientForm.email}
                    onChange={(e) =>
                      setNewClientForm((f) => ({
                        ...f,
                        email: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="new-client-telefone">Telefone</Label>
                  <Input
                    id="new-client-telefone"
                    value={newClientForm.telefone}
                    onChange={(e) =>
                      setNewClientForm((f) => ({
                        ...f,
                        telefone: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="new-client-razao">Razao Social</Label>
                  <Input
                    id="new-client-razao"
                    value={newClientForm.razaoSocial}
                    onChange={(e) =>
                      setNewClientForm((f) => ({
                        ...f,
                        razaoSocial: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="new-client-endereco">Endereco</Label>
                  <Input
                    id="new-client-endereco"
                    value={newClientForm.endereco}
                    onChange={(e) =>
                      setNewClientForm((f) => ({
                        ...f,
                        endereco: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateAndLink}
                disabled={
                  linking ||
                  !newClientForm.name.trim() ||
                  !newClientForm.cpfCnpj.trim()
                }
              >
                {linking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Criar e Vincular"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Request Refund Dialog (US-085) */}
        <RequestRefundDialog
          open={requestRefundOpen}
          onOpenChange={setRequestRefundOpen}
          ticketId={ticket.id}
          companyId={companyId}
          boletoId={ticket?.boletoId}
          onSuccess={handleRefundSuccess}
        />

        {/* Reject Refund Dialog (US-085) */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rejeitar Reembolso</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="reject-reason">Motivo da Rejeicao *</Label>
                <Textarea
                  id="reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Descreva o motivo da rejeição..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setRejectDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleRejectRefund}
                disabled={submittingReject || !rejectReason.trim()}
              >
                {submittingReject ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Rejeitando...
                  </>
                ) : (
                  "Confirmar Rejeicao"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Execute Refund Dialog (US-085) */}
        <ExecuteRefundDialog
          open={executeDialogOpen}
          onOpenChange={setExecuteDialogOpen}
          refundId={executeRefundId}
          ticketId={ticket.id}
          companyId={companyId}
          onSuccess={handleRefundSuccess}
        />

        {/* RA Moderation Dialog */}
        {ticket.channelType === "RECLAMEAQUI" && (
          <RaModerationDialog
            open={raModerationOpen}
            onOpenChange={setRaModerationOpen}
            ticketId={ticket.id}
            companyId={companyId}
            onSuccess={onTicketUpdated}
          />
        )}

        {/* Request Cancellation Dialog (US-086) */}
        <CancellationDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          ticketId={ticket.id}
          companyId={companyId}
          proposalId={ticket?.proposalId}
          boletoId={ticket?.boletoId}
          onSuccess={handleCancellationSuccess}
        />
      </>
    );
  }
);
