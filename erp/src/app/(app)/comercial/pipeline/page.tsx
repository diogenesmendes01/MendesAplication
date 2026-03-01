"use client";

import { useState, useEffect, useCallback, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Filter, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/company-context";
import { updateProposalStatus } from "../propostas/actions";
import {
  listPipelineData,
  listClientsForPipeline,
  type PipelineData,
  type PipelineStage,
  type PipelineCard,
  type ClientOption,
} from "./actions";

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

const STAGE_COLORS: Record<PipelineStage, string> = {
  DRAFT: "border-t-gray-400",
  SENT: "border-t-blue-400",
  ACCEPTED: "border-t-green-400",
  BOLETO_GENERATED: "border-t-purple-400",
  PAID: "border-t-emerald-500",
};

const STAGE_BG: Record<PipelineStage, string> = {
  DRAFT: "bg-gray-50",
  SENT: "bg-blue-50",
  ACCEPTED: "bg-green-50",
  BOLETO_GENERATED: "bg-purple-50",
  PAID: "bg-emerald-50",
};

const CARD_HOVER: Record<PipelineStage, string> = {
  DRAFT: "hover:border-gray-400",
  SENT: "hover:border-blue-400",
  ACCEPTED: "hover:border-green-400",
  BOLETO_GENERATED: "hover:border-purple-400",
  PAID: "hover:border-emerald-500",
};

// Valid drag-and-drop transitions (only proposal status changes)
const VALID_DROP_TARGETS: Record<PipelineStage, PipelineStage[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED"],
  ACCEPTED: [],
  BOLETO_GENERATED: [],
  PAID: [],
};

// Map pipeline stage to proposal status for updateProposalStatus
function stageToProposalStatus(
  stage: PipelineStage
): "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | null {
  switch (stage) {
    case "DRAFT":
      return "DRAFT";
    case "SENT":
      return "SENT";
    case "ACCEPTED":
      return "ACCEPTED";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PipelinePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompany();

  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterClientId, setFilterClientId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterValueMin, setFilterValueMin] = useState("");
  const [filterValueMax, setFilterValueMax] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Clients for filter dropdown
  const [clients, setClients] = useState<ClientOption[]>([]);

  // Drag-and-drop state
  const [draggedCard, setDraggedCard] = useState<{
    card: PipelineCard;
    sourceStage: PipelineStage;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<PipelineStage | null>(null);

  const hasActiveFilters =
    filterClientId !== "" ||
    filterDateFrom !== "" ||
    filterDateTo !== "" ||
    filterValueMin !== "" ||
    filterValueMax !== "";

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadPipeline = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const data = await listPipelineData({
        companyId: selectedCompanyId,
        clientId: filterClientId || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        valueMin: filterValueMin ? parseFloat(filterValueMin) : undefined,
        valueMax: filterValueMax ? parseFloat(filterValueMax) : undefined,
      });
      setPipelineData(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar pipeline"
      );
    } finally {
      setLoading(false);
    }
  }, [
    selectedCompanyId,
    filterClientId,
    filterDateFrom,
    filterDateTo,
    filterValueMin,
    filterValueMax,
  ]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    listClientsForPipeline(selectedCompanyId).then(setClients).catch(() => {});
  }, [selectedCompanyId]);

  // ---------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------

  function clearFilters() {
    setFilterClientId("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterValueMin("");
    setFilterValueMax("");
  }

  // ---------------------------------------------------
  // Drag-and-drop handlers
  // ---------------------------------------------------

  function handleDragStart(
    e: DragEvent<HTMLDivElement>,
    card: PipelineCard,
    sourceStage: PipelineStage
  ) {
    setDraggedCard({ card, sourceStage });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.id);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, stage: PipelineStage) {
    e.preventDefault();
    if (!draggedCard) return;

    const validTargets = VALID_DROP_TARGETS[draggedCard.sourceStage];
    if (validTargets.includes(stage)) {
      e.dataTransfer.dropEffect = "move";
      setDropTarget(stage);
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  }

  function handleDragLeave() {
    setDropTarget(null);
  }

  async function handleDrop(
    e: DragEvent<HTMLDivElement>,
    targetStage: PipelineStage
  ) {
    e.preventDefault();
    setDropTarget(null);

    if (!draggedCard || !selectedCompanyId) return;

    const validTargets = VALID_DROP_TARGETS[draggedCard.sourceStage];
    if (!validTargets.includes(targetStage)) {
      toast.error("Transição de status não permitida");
      setDraggedCard(null);
      return;
    }

    const newStatus = stageToProposalStatus(targetStage);
    if (!newStatus) {
      setDraggedCard(null);
      return;
    }

    try {
      await updateProposalStatus(
        draggedCard.card.id,
        newStatus,
        selectedCompanyId
      );
      toast.success(`Proposta movida para ${targetStage === "SENT" ? "Enviada" : "Aceita"}`);
      await loadPipeline();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao atualizar status"
      );
    } finally {
      setDraggedCard(null);
    }
  }

  function handleDragEnd() {
    setDraggedCard(null);
    setDropTarget(null);
  }

  // ---------------------------------------------------
  // Card click — navigate to detail/edit
  // ---------------------------------------------------

  function handleCardClick(card: PipelineCard, stage: PipelineStage) {
    if (stage === "DRAFT") {
      router.push(`/comercial/propostas/nova?edit=${card.id}`);
    } else {
      router.push(`/comercial/propostas/${card.id}`);
    }
  }

  // ---------------------------------------------------
  // No company
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar o pipeline.
      </div>
    );
  }

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  const totalValue = pipelineData
    ? pipelineData.columns.reduce((sum, col) => sum + parseFloat(col.total), 0)
    : 0;

  const totalCards = pipelineData
    ? pipelineData.columns.reduce((sum, col) => sum + col.count, 0)
    : 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Pipeline Comercial
          </h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe o funil de vendas com visão Kanban
          </p>
        </div>
      </div>

      {/* Metrics bar */}
      {pipelineData && (
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2 rounded-md border bg-card px-4 py-2">
            <span className="text-sm text-muted-foreground">
              Total no pipeline:
            </span>
            <span className="font-semibold">
              {totalCards} proposta{totalCards !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-card px-4 py-2">
            <span className="text-sm text-muted-foreground">Valor total:</span>
            <span className="font-mono font-semibold">
              {currencyFmt.format(totalValue)}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-card px-4 py-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Taxa de conversão:
            </span>
            <span className="font-semibold">
              {pipelineData.conversionRate.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* Filters toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersVisible((v) => !v)}
        >
          <Filter className="mr-2 h-4 w-4" />
          Filtros
          {hasActiveFilters && (
            <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              !
            </span>
          )}
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Filter panel */}
      {filtersVisible && (
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <Select
              value={filterClientId || "__all__"}
              onValueChange={(v) =>
                setFilterClientId(v === "__all__" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Data de</Label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Data até</Label>
            <Input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Valor mínimo</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="R$ 0,00"
              value={filterValueMin}
              onChange={(e) => setFilterValueMin(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Valor máximo</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="R$ 0,00"
              value={filterValueMax}
              onChange={(e) => setFilterValueMax(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Kanban Board */}
      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Carregando pipeline...
        </div>
      ) : !pipelineData ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Nenhum dado encontrado.
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {pipelineData.columns.map((column) => {
            const isValidTarget =
              draggedCard !== null &&
              VALID_DROP_TARGETS[draggedCard.sourceStage].includes(
                column.stage
              );
            const isHovering = dropTarget === column.stage;

            return (
              <div
                key={column.stage}
                className={`flex w-72 min-w-[18rem] flex-col rounded-lg border-t-4 ${STAGE_COLORS[column.stage]} ${
                  isHovering
                    ? "ring-2 ring-primary ring-offset-2"
                    : isValidTarget
                      ? "ring-1 ring-primary/30"
                      : ""
                } ${STAGE_BG[column.stage]} transition-all`}
                onDragOver={(e) => handleDragOver(e, column.stage)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, column.stage)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{column.label}</h3>
                    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1.5 text-xs font-medium text-muted-foreground shadow-sm">
                      {column.count}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {currencyFmt.format(parseFloat(column.total))}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 340px)" }}>
                  {column.cards.length === 0 ? (
                    <div className="flex h-20 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                      Nenhuma proposta
                    </div>
                  ) : (
                    column.cards.map((card) => {
                      const isDraggable =
                        VALID_DROP_TARGETS[column.stage].length > 0;
                      return (
                        <div
                          key={card.id}
                          draggable={isDraggable}
                          onDragStart={(e) =>
                            handleDragStart(e, card, column.stage)
                          }
                          onDragEnd={handleDragEnd}
                          onClick={() => handleCardClick(card, column.stage)}
                          className={`cursor-pointer rounded-md border bg-white p-3 shadow-sm transition-all ${CARD_HOVER[column.stage]} ${
                            isDraggable ? "cursor-grab active:cursor-grabbing" : ""
                          } ${
                            draggedCard?.card.id === card.id
                              ? "opacity-50"
                              : ""
                          }`}
                        >
                          <p className="text-sm font-medium leading-tight">
                            {card.clientName}
                          </p>
                          <p className="mt-1 font-mono text-sm font-semibold text-primary">
                            {currencyFmt.format(parseFloat(card.totalValue))}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {dateFmt.format(new Date(card.createdAt))}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
