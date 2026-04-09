"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  User,
  Calendar,
  Building2,
  FileText,
  CreditCard,
  Globe,
  X,
  Plus,
  DollarSign,
  ExternalLink,
  FileDown,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  type TicketDetail,
  type ClientFinancialSummary,
  reassignTicket,
  addTag,
  removeTag,
} from "../../actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function getFeelingEmoji(feeling: string | null): string {
  if (!feeling) return "";
  const f = feeling.toLowerCase();
  if (f.includes("irritado") || f.includes("raiva")) return "😡";
  if (f.includes("triste") || f.includes("decepcionado")) return "😢";
  if (f.includes("neutro")) return "😐";
  if (f.includes("satisfeito")) return "😊";
  return "💬";
}

type RaFormField = { name: string; value: string };

function isRaFormFields(val: unknown): val is RaFormField[] {
  return (
    Array.isArray(val) &&
    val.every(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        "name" in f &&
        "value" in f &&
        typeof (f as Record<string, unknown>).name === "string" &&
        typeof (f as Record<string, unknown>).value === "string"
    )
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RaSidebarProps {
  ticket: TicketDetail;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raContext: any;
  companyId: string;
  users: { id: string; name: string }[];
  financial: ClientFinancialSummary | null;
  onTicketUpdated: () => void;
  onOpenExportDialog: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RaSidebar({
  ticket,
  raContext,
  companyId,
  users,
  financial,
  onTicketUpdated,
  onOpenExportDialog,
}: RaSidebarProps) {
  const router = useRouter();

  // Local state for assignee & tags (mirrors page.tsx pattern)
  const [updatingAssignee, setUpdatingAssignee] = useState(false);
  const [tags, setTags] = useState<string[]>(ticket.tags);
  const [newTag, setNewTag] = useState("");

  // ---------------------------------------------------
  // Reassign
  // ---------------------------------------------------

  async function handleReassign(assigneeId: string) {
    setUpdatingAssignee(true);
    try {
      const result = await reassignTicket(
        ticket.id,
        companyId,
        assigneeId === "__none__" ? null : assigneeId
      );
      toast.success(
        result.assignee
          ? `Ticket reatribuído para ${result.assignee.name}`
          : "Responsável removido"
      );
      onTicketUpdated();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao reatribuir ticket"
      );
    } finally {
      setUpdatingAssignee(false);
    }
  }

  // ---------------------------------------------------
  // Tags
  // ---------------------------------------------------

  async function handleAddTag() {
    if (!newTag.trim()) return;
    try {
      const updatedTags = await addTag(ticket.id, companyId, newTag.trim());
      setTags(updatedTags);
      setNewTag("");
      toast.success("Tag adicionada");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao adicionar tag"
      );
    }
  }

  async function handleRemoveTag(tag: string) {
    try {
      const updatedTags = await removeTag(ticket.id, companyId, tag);
      setTags(updatedTags);
      toast.success("Tag removida");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover tag");
    }
  }

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  return (
    <div className="space-y-6">
      {/* 1. Consumer info */}
      <Card className="border-purple-100">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-purple-700 flex items-center gap-2 uppercase tracking-wide">
            <User className="h-3.5 w-3.5" />
            Consumidor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 font-bold text-sm">
              {(raContext?.client?.name ?? ticket.client.name)
                .charAt(0)
                .toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold">
                {raContext?.client?.name ?? ticket.client.name}
              </p>
              {(raContext?.client?.email ?? ticket.client.email) && (
                <p className="text-xs text-muted-foreground">
                  {raContext?.client?.email ?? ticket.client.email}
                </p>
              )}
              {raContext?.client?.phone && (
                <p className="text-xs text-muted-foreground">
                  {raContext.client.phone}
                </p>
              )}
              {raContext?.client?.cpfCnpj &&
                !raContext.client.cpfCnpj.startsWith("RA-") && (
                  <p className="text-xs text-muted-foreground font-mono">
                    {raContext.client.cpfCnpj}
                  </p>
                )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. RA Status & metrics */}
      <Card className="border-purple-100">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-purple-700 flex items-center gap-2 uppercase tracking-wide">
            <Globe className="h-3.5 w-3.5" />
            Status Reclame Aqui
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ticket.raStatusName && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status RA</span>
              <span className="text-xs font-semibold text-purple-700">
                {ticket.raStatusName}
              </span>
            </div>
          )}
          {ticket.raRating != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Avaliação</span>
              <span className="text-xs font-semibold">
                ⭐ {ticket.raRating}/10
              </span>
            </div>
          )}
          {raContext?.raFeeling && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Sentimento</span>
              <span className="text-xs font-medium">
                {getFeelingEmoji(raContext.raFeeling)} {raContext.raFeeling}
              </span>
            </div>
          )}
          {raContext?.raResolvedIssue != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Resolvido</span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${raContext.raResolvedIssue ? "text-green-700" : "text-red-700"}`}
              >
                {raContext.raResolvedIssue ? (
                  <ThumbsUp className="h-3 w-3" />
                ) : (
                  <ThumbsDown className="h-3 w-3" />
                )}
                {raContext.raResolvedIssue ? "Sim" : "Não"}
              </span>
            </div>
          )}
          {raContext?.raBackDoingBusiness != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Voltaria a comprar
              </span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${raContext.raBackDoingBusiness ? "text-green-700" : "text-red-700"}`}
              >
                {raContext.raBackDoingBusiness ? (
                  <ThumbsUp className="h-3 w-3" />
                ) : (
                  <ThumbsDown className="h-3 w-3" />
                )}
                {raContext.raBackDoingBusiness ? "Sim" : "Não"}
              </span>
            </div>
          )}
          {raContext?.raCategories?.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Categorias</p>
              <div className="flex flex-wrap gap-1">
                {raContext.raCategories.map((cat: string, i: number) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {raContext?.raFrozen && (
            <Badge
              variant="destructive"
              className="w-full justify-center text-xs"
            >
              🧊 Ticket congelado
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* 3. Dados da Reclamação (form fields) */}
      {isRaFormFields(ticket.raFormFields) &&
        ticket.raFormFields.length > 0 && (
          <Card className="border-purple-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-purple-600" />
                Dados da Reclamação
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ticket.raFormFields.map((field, i) => (
                <div key={i}>
                  <p className="text-xs font-medium text-muted-foreground">
                    {field.name}
                  </p>
                  <p className="text-sm">{field.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

      {/* 4. Responsável */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Responsável</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="assignee-ra">Atribuir a</Label>
            <Select
              value={ticket.assignee?.id ?? "__none__"}
              onValueChange={handleReassign}
              disabled={updatingAssignee}
            >
              <SelectTrigger id="assignee-ra">
                <SelectValue placeholder="Selecione um responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nenhum</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 5. Tags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {tags.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma tag</p>
            )}
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Nova tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddTag}
              disabled={!newTag.trim()}
              className="h-8 px-2"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 6. General info (compact) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Informações Gerais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Empresa
              </p>
              <p className="text-sm">{ticket.company.nomeFantasia}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Criado em
              </p>
              <p className="text-sm">
                {dateFmt.format(new Date(ticket.createdAt))}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Atualizado em
              </p>
              <p className="text-sm">
                {dateFmt.format(new Date(ticket.updatedAt))}
              </p>
            </div>
          </div>
          {ticket.proposalId && (
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Proposta Vinculada
                </p>
                <p className="text-sm text-primary">
                  #{ticket.proposalId.slice(-8)}
                </p>
              </div>
            </div>
          )}
          {ticket.boletoId && (
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Boleto Vinculado
                </p>
                <p className="text-sm text-primary">
                  #{ticket.boletoId.slice(-8)}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Financial (RA context -- kept) */}
      {financial && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Situação Financeira
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge
              variant={
                financial.status === "adimplente" ? "default" : "destructive"
              }
              className={
                financial.status === "adimplente"
                  ? "bg-green-100 text-green-800 hover:bg-green-100"
                  : financial.status === "atraso"
                    ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
                    : ""
              }
            >
              {financial.status === "adimplente"
                ? "Adimplente"
                : financial.status === "atraso"
                  ? "Em Atraso"
                  : "Inadimplente"}
            </Badge>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Total Pendente</p>
                <p className="font-medium">
                  R${" "}
                  {financial.pendingTotal.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Vencido</p>
                <p className="font-medium text-red-600">
                  R${" "}
                  {financial.overdueTotal.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
            {financial.lastPayment && (
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">
                  Último Pagamento
                </p>
                <p>{dateFmt.format(new Date(financial.lastPayment))}</p>
              </div>
            )}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => router.push("/financeiro/receber")}
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              Ver financeiro
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 7. Export PDF */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileDown className="h-4 w-4" />
            Exportar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            onClick={onOpenExportDialog}
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Exportar PDF
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
