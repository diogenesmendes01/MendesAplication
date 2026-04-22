"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MergedTicketBannerProps { mergedIntoId: string; mergedAt: string; }

export default function MergedTicketBanner({ mergedIntoId, mergedAt }: MergedTicketBannerProps) {
  const date = new Date(mergedAt).toLocaleDateString("pt-BR");
  return (
    <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-orange-800 dark:text-orange-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Este ticket foi mergeado em outro ticket em {date}</span>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => window.open(`/sac/tickets/${mergedIntoId}`, "_blank")}>
          Ir para ticket principal <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </div>
    </div>
  );
}
