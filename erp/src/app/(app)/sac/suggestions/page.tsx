"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Bot,
  Loader2,
  ExternalLink,
  Filter,
  Check,
  X,
  Pencil,
  Clock,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { useCompany } from "@/contexts/company-context";
import {
  listSuggestions,
  getSuggestionStats,
  type SuggestionListItem,
} from "./actions";
import {
  approveSuggestionAction,
  rejectSuggestionAction,
} from "../tickets/[id]/suggestion-actions";
import { toast } from "sonner";
import { timeAgo, confidenceColor } from "@/utils/suggestion-helpers";

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

function channelLabel(channel: string): string {
  switch (channel) {
    case "WHATSAPP": return "WhatsApp";
    case "EMAIL": return "Email";
    case "RECLAMEAQUI": return "Reclame Aqui";
    default: return channel;
  }
}

function channelColor(channel: string): string {
  switch (channel) {
    case "WHATSAPP": return "border-green-300 text-green-700 bg-green-50";
    case "EMAIL": return "border-blue-300 text-blue-700 bg-blue-50";
    case "RECLAMEAQUI": return "border-purple-300 text-purple-700 bg-purple-50";
    default: return "";
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "PENDING": return <Clock className="h-3.5 w-3.5 text-yellow-600" />;
    case "APPROVED": return <Check className="h-3.5 w-3.5 text-green-600" />;
    case "REJECTED": return <X className="h-3.5 w-3.5 text-red-600" />;
    case "EDITED": return <Pencil className="h-3.5 w-3.5 text-blue-600" />;
    default: return null;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "PENDING": return "Pendente";
    case "APPROVED": return "Aprovado";
    case "REJECTED": return "Rejeitado";
    case "EDITED": return "Editado";
    case "EXPIRED": return "Expirado";
    case "PROCESSING": return "Processando";
    default: return status;
  }
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case "PENDING": return "border-yellow-300 text-yellow-700 bg-yellow-50";
    case "APPROVED": return "border-green-300 text-green-700 bg-green-50";
    case "REJECTED": return "border-red-300 text-red-700 bg-red-50";
    case "EDITED": return "border-blue-300 text-blue-700 bg-blue-50";
    default: return "";
  }
}

// ---------------------------------------------------------------------------
// Stats Cards
// ---------------------------------------------------------------------------

function StatsCards({
  stats,
}: {
  stats: { pending: number; approved: number; rejected: number; edited: number };
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="border-yellow-200 bg-yellow-50/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-yellow-700 font-medium">Pendentes</p>
              <p className="text-2xl font-bold text-yellow-800">{stats.pending}</p>
            </div>
            <Clock className="h-8 w-8 text-yellow-400" />
          </div>
        </CardContent>
      </Card>
      <Card className="border-green-200 bg-green-50/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-green-700 font-medium">Aprovadas</p>
              <p className="text-2xl font-bold text-green-800">{stats.approved}</p>
            </div>
            <Check className="h-8 w-8 text-green-400" />
          </div>
        </CardContent>
      </Card>
      <Card className="border-red-200 bg-red-50/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-red-700 font-medium">Rejeitadas</p>
              <p className="text-2xl font-bold text-red-800">{stats.rejected}</p>
            </div>
            <X className="h-8 w-8 text-red-400" />
          </div>
        </CardContent>
      </Card>
      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-blue-700 font-medium">Editadas</p>
              <p className="text-2xl font-bold text-blue-800">{stats.edited}</p>
            </div>
            <Pencil className="h-8 w-8 text-blue-400" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion Row
// ---------------------------------------------------------------------------

function SuggestionRow({
  item,
  companyId,
  onUpdate,
}: {
  item: SuggestionListItem;
  companyId: string;
  onUpdate: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const isPending = item.status === "PENDING";

  async function handleApprove() {
    setLoading(true);
    try {
      await approveSuggestionAction(item.id, companyId);
      toast.success("Sugestão aprovada");
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar");
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setLoading(true);
    try {
      await rejectSuggestionAction(item.id, companyId);
      toast.success("Sugestão rejeitada");
      setRejectDialogOpen(false);
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao rejeitar");
    } finally {
      setLoading(false);
    }
  }

  const confidencePct = Math.round(item.confidence * 100);

  return (
    <>
      <div className={`rounded-lg border p-4 space-y-3 transition-colors ${
        isPending ? "border-yellow-200 bg-yellow-50/30" : "bg-card"
      }`}>
        {/* Header row */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Bot className="h-4 w-4 text-purple-600" />
            <Link
              href={`/sac/tickets/${item.ticketId}`}
              className="text-sm font-semibold text-primary hover:underline"
            >
              {item.ticketSubject}
            </Link>
            <Badge variant="outline" className={`text-[10px] ${channelColor(item.channel)}`}>
              {channelLabel(item.channel)}
            </Badge>
            <Badge variant="outline" className={`text-[10px] ${statusBadgeColor(item.status)}`}>
              {statusIcon(item.status)}
              <span className="ml-1">{statusLabel(item.status)}</span>
            </Badge>
            <Badge className={`text-[10px] ${confidenceColor(item.confidence)}`}>
              {confidencePct}%
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {timeAgo(item.createdAt)}
          </span>
        </div>

        {/* Response preview */}
        <p className="text-sm text-muted-foreground line-clamp-2">
          {item.editedResponse || item.suggestedResponse}
        </p>

        {/* Reviewer info */}
        {item.reviewerName && (
          <p className="text-xs text-muted-foreground">
            {item.status === "EDITED"
              ? `Editado e aprovado por ${item.reviewerName}`
              : item.status === "APPROVED"
                ? `Aprovado por ${item.reviewerName}`
                : item.status === "REJECTED"
                  ? `Rejeitado por ${item.reviewerName}`
                  : ""}
            {item.reviewedAt && ` — ${dateFmt.format(new Date(item.reviewedAt))}`}
          </p>
        )}

        {/* Quick actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/sac/tickets/${item.ticketId}`}>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              <ExternalLink className="h-3 w-3" />
              Ver ticket
            </Button>
          </Link>

          {isPending && (
            <>
              <Button
                size="sm"
                className="h-7 text-xs bg-green-600 hover:bg-green-700 gap-1"
                disabled={loading}
                onClick={handleApprove}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-red-200 text-red-700 hover:bg-red-50 gap-1"
                disabled={loading}
                onClick={() => setRejectDialogOpen(true)}
              >
                <X className="h-3 w-3" />
                Rejeitar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Reject confirmation dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rejeitar sugestão?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A sugestão da IA será rejeitada e não será enviada.
            Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {loading ? "Rejeitando..." : "Confirmar Rejeição"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SuggestionsQueuePage() {
  const { selectedCompanyId } = useCompany();
  const [items, setItems] = useState<SuggestionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, edited: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [channelFilter, setChannelFilter] = useState("ALL");
  const [page, setPage] = useState(0);
  const limit = 25;

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const [suggestionsResult, statsResult] = await Promise.all([
        listSuggestions(selectedCompanyId, {
          status: statusFilter === "ALL" ? undefined : statusFilter,
          channel: channelFilter === "ALL" ? undefined : (channelFilter as "WHATSAPP" | "EMAIL" | "RECLAMEAQUI"),
          limit,
          offset: page * limit,
        }),
        getSuggestionStats(selectedCompanyId),
      ]);
      setItems(suggestionsResult.items);
      setTotal(suggestionsResult.total);
      setStats(statsResult);
    } catch {
      toast.error("Erro ao carregar sugestões");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, statusFilter, channelFilter, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar as sugestões.
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-purple-600" />
            Fila de Sugestões da IA
          </h1>
          <p className="text-sm text-muted-foreground">
            Revise e aprove sugestões do agente IA antes de enviá-las
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <StatsCards stats={stats} />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filtros:</span>
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos</SelectItem>
            <SelectItem value="PENDING">Pendentes</SelectItem>
            <SelectItem value="APPROVED">Aprovados</SelectItem>
            <SelectItem value="REJECTED">Rejeitados</SelectItem>
            <SelectItem value="EDITED">Editados</SelectItem>
            <SelectItem value="EXPIRED">Expirados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos os canais</SelectItem>
            <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
            <SelectItem value="RECLAMEAQUI">Reclame Aqui</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {total} resultado{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando sugestões...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Bot className="h-12 w-12 mb-3 text-muted-foreground/50" />
            <p className="text-sm">Nenhuma sugestão encontrada</p>
            <p className="text-xs mt-1">
              {statusFilter === "PENDING"
                ? "Todas as sugestões pendentes foram revisadas 🎉"
                : "Ajuste os filtros para ver mais resultados"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <SuggestionRow
              key={item.id}
              item={item}
              companyId={selectedCompanyId}
              onUpdate={loadData}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}
