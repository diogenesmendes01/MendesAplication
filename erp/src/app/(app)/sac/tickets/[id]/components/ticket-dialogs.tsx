"use client";

import { Search, Loader2, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClientForLink } from "../../actions";

// --- Export PDF Dialog ---

interface ExportPdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  includeNotes: boolean;
  onIncludeNotesChange: (v: boolean) => void;
  includeAttachments: boolean;
  onIncludeAttachmentsChange: (v: boolean) => void;
  exporting: boolean;
  onExport: () => void;
}

export function ExportPdfDialog({
  open, onOpenChange, includeNotes, onIncludeNotesChange,
  includeAttachments, onIncludeAttachmentsChange, exporting, onExport,
}: ExportPdfDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Exportar Ticket como PDF</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="export-notes" checked={includeNotes} onCheckedChange={(c) => onIncludeNotesChange(c === true)} />
            <Label htmlFor="export-notes" className="text-sm font-normal cursor-pointer">Incluir notas internas</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="export-attachments" checked={includeAttachments} onCheckedChange={(c) => onIncludeAttachmentsChange(c === true)} />
            <Label htmlFor="export-attachments" className="text-sm font-normal cursor-pointer">Incluir lista de anexos</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onExport} disabled={exporting}>
            {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
            {exporting ? "Exportando..." : "Exportar PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Link Client Dialog (US-081) ---

interface LinkClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearch: (query: string) => void;
  searching: boolean;
  results: ClientForLink[];
  linking: boolean;
  onLink: (clientId: string) => void;
}

export function LinkClientDialog({
  open, onOpenChange, search, onSearch, searching, results, linking, onLink,
}: LinkClientDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular a Cliente Existente</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nome ou CNPJ/CPF..." value={search} onChange={(e) => onSearch(e.target.value)} className="pl-9" />
          </div>
          {searching && (
            <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />Buscando...
            </div>
          )}
          {!searching && search.length >= 2 && results.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum cliente encontrado</p>
          )}
          {results.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {results.map((client) => (
                <button key={client.id} type="button" disabled={linking} onClick={() => onLink(client.id)} className="w-full rounded-md border p-3 text-left hover:bg-muted transition-colors">
                  <p className="text-sm font-medium">{client.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {client.cpfCnpj}{client.email && ` · ${client.email}`}{client.telefone && ` · ${client.telefone}`}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Create Client Dialog (US-081) ---

interface NewClientForm {
  name: string;
  cpfCnpj: string;
  type: "PF" | "PJ";
  email: string;
  telefone: string;
  razaoSocial: string;
  endereco: string;
}

interface CreateClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: NewClientForm;
  onFormChange: (form: NewClientForm) => void;
  linking: boolean;
  onCreateAndLink: () => void;
}

export function CreateClientDialog({
  open, onOpenChange, form, onFormChange, linking, onCreateAndLink,
}: CreateClientDialogProps) {
  const update = (partial: Partial<NewClientForm>) => onFormChange({ ...form, ...partial });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar Novo Cliente e Vincular</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="new-client-name">Nome *</Label>
              <Input id="new-client-name" value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="Nome do cliente" />
            </div>
            <div>
              <Label htmlFor="new-client-type">Tipo *</Label>
              <Select value={form.type} onValueChange={(v) => update({ type: v as "PF" | "PJ" })}>
                <SelectTrigger id="new-client-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PJ">Pessoa Juridica</SelectItem>
                  <SelectItem value="PF">Pessoa Fisica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="new-client-cpfcnpj">{form.type === "PF" ? "CPF" : "CNPJ"} *</Label>
              <Input id="new-client-cpfcnpj" value={form.cpfCnpj} onChange={(e) => update({ cpfCnpj: e.target.value })} placeholder={form.type === "PF" ? "000.000.000-00" : "00.000.000/0000-00"} />
            </div>
            <div>
              <Label htmlFor="new-client-email">Email</Label>
              <Input id="new-client-email" type="email" value={form.email} onChange={(e) => update({ email: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="new-client-telefone">Telefone</Label>
              <Input id="new-client-telefone" value={form.telefone} onChange={(e) => update({ telefone: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="new-client-razao">Razao Social</Label>
              <Input id="new-client-razao" value={form.razaoSocial} onChange={(e) => update({ razaoSocial: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="new-client-endereco">Endereco</Label>
              <Input id="new-client-endereco" value={form.endereco} onChange={(e) => update({ endereco: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onCreateAndLink} disabled={linking || !form.name.trim() || !form.cpfCnpj.trim()}>
            {linking ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Criando...</>) : "Criar e Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Reject Refund Dialog (US-085) ---

interface RejectRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  submitting: boolean;
  onReject: () => void;
}

export function RejectRefundDialog({
  open, onOpenChange, reason, onReasonChange, submitting, onReject,
}: RejectRefundDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rejeitar Reembolso</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="reject-reason">Motivo da Rejeicao *</Label>
            <Textarea id="reject-reason" value={reason} onChange={(e) => onReasonChange(e.target.value)} placeholder="Descreva o motivo da rejeicao..." rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={onReject} disabled={submitting || !reason.trim()}>
            {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Rejeitando...</>) : "Confirmar Rejeicao"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
