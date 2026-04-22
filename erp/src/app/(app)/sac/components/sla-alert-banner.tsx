"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SlaAlertBannerProps {
  breached: number;
  atRisk: number;
  onViewSlaCritical: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlaAlertBanner({
  breached,
  atRisk,
  onViewSlaCritical,
}: SlaAlertBannerProps) {
  if (breached === 0 && atRisk === 0) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {breached > 0 && (
          <span className="font-semibold text-red-700">
            {breached} {breached === 1 ? "estourado" : "estourados"}
          </span>
        )}
        {breached > 0 && atRisk > 0 && (
          <span className="text-red-400">|</span>
        )}
        {atRisk > 0 && (
          <span className="font-semibold text-yellow-700">
            {atRisk} em risco
          </span>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 border-red-300 text-red-700 hover:bg-red-100"
        onClick={onViewSlaCritical}
      >
        Ver SLA Crítico
      </Button>
    </div>
  );
}
