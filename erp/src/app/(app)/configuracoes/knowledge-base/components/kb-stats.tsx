"use client";

import { FileText, Layers, Clock, Tag } from "lucide-react";
import type { KBStats } from "../actions";

function timeAgo(date: Date | null): string {
  if (!date) return "—";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

export function KbStatsBar({ stats }: { stats: KBStats | null }) {
  if (!stats) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <FileText className="h-4 w-4" />
        {stats.activeDocuments} documentos
      </span>
      <span className="flex items-center gap-1.5">
        <Layers className="h-4 w-4" />
        {stats.totalChunks} chunks
      </span>
      <span className="flex items-center gap-1.5">
        <Tag className="h-4 w-4" />
        {stats.categories.length} categorias
      </span>
      <span className="flex items-center gap-1.5">
        <Clock className="h-4 w-4" />
        Última atualização: {timeAgo(stats.lastUpdated)}
      </span>
    </div>
  );
}
