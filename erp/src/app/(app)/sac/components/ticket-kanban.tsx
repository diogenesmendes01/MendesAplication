"use client";

import { useState, useEffect, useCallback } from "react";
import { Inbox } from "lucide-react";
import { useCompany } from "@/contexts/company-context";
import {
  getKanbanBootstrap,
  type TicketRow,
  type KanbanBootstrapResult,
} from "../tickets/actions";
import { TicketCard } from "./ticket-card";
import type { ChannelType, TicketStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface KanbanColumn {
  status: TicketStatus;
  label: string;
  headerClass: string;
}

const COLUMNS: KanbanColumn[] = [
  { status: "OPEN", label: "Aberto", headerClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800" },
  { status: "IN_PROGRESS", label: "Em Andamento", headerClass: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800" },
  { status: "WAITING_CLIENT", label: "Aguardando", headerClass: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800" },
  { status: "RESOLVED", label: "Resolvido", headerClass: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800" },
  { status: "CLOSED", label: "Fechado", headerClass: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700" },
];

// ---------------------------------------------------------------------------
// Skeleton card (no external dependency)
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2 animate-pulse">
      <div className="h-3 w-3/4 rounded bg-muted" />
      <div className="h-4 w-full rounded bg-muted" />
      <div className="h-3 w-1/2 rounded bg-muted" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single column
// ---------------------------------------------------------------------------

interface ColumnProps {
  column: KanbanColumn;
  tickets: TicketRow[];
  total: number;
  loading: boolean;
}

function KanbanColumnView({ column, tickets, total, loading }: ColumnProps) {
  // When total > tickets displayed, show asterisk hint
  const isTruncated = !loading && total > tickets.length;

  return (
    <div className="flex flex-col min-w-[260px] max-w-[280px] shrink-0">
      {/* Column header */}
      <div className={`
        flex items-center justify-between rounded-t-lg border px-3 py-2 mb-2
        ${column.headerClass}
      `}>
        <span className="text-xs font-semibold uppercase tracking-wide">
          {column.label}
        </span>
        <span
          className="text-xs font-bold tabular-nums"
          title={isTruncated ? `${total} tickets no total; exibindo primeiros ${tickets.length}` : undefined}
        >
          {loading ? "—" : total}
          {isTruncated && (
            <span className="ml-0.5 opacity-60 text-[10px]">*</span>
          )}
        </span>
      </div>

      {/* Cards list — Fix 3: use min/max height instead of fixed calc */}
      <div className="flex-1 min-h-[400px] max-h-[calc(100vh-200px)] overflow-y-auto space-y-2 pr-0.5">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <Inbox className="h-6 w-6 opacity-40" />
            <span className="text-xs">Nenhum ticket</span>
          </div>
        ) : (
          tickets.map((t) => <TicketCard key={t.id} row={t} />)
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TicketKanban
// ---------------------------------------------------------------------------

interface TicketKanbanProps {
  channelType?: ChannelType;
}

type ColumnDataMap = Pick<KanbanBootstrapResult, TicketStatus>;

const EMPTY_DATA: ColumnDataMap = {
  OPEN: { data: [], total: 0 },
  IN_PROGRESS: { data: [], total: 0 },
  WAITING_CLIENT: { data: [], total: 0 },
  RESOLVED: { data: [], total: 0 },
  CLOSED: { data: [], total: 0 },
  MERGED: { data: [], total: 0 },
};

export function TicketKanban({ channelType }: TicketKanbanProps) {
  const { selectedCompanyId } = useCompany();

  const [columnData, setColumnData] = useState<ColumnDataMap>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      // Fix 4: single auth check + parallel status queries via getKanbanBootstrap
      const result = await getKanbanBootstrap(selectedCompanyId, channelType);
      setColumnData(result);
    } catch (err) {
      console.warn("SAC: failed to load kanban data", err);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, channelType]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map((col) => (
        <KanbanColumnView
          key={col.status}
          column={col}
          tickets={columnData[col.status].data}
          total={columnData[col.status].total}
          loading={loading}
        />
      ))}
    </div>
  );
}
