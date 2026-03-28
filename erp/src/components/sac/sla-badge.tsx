"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SlaStatusValue } from "@/lib/sla";

interface SlaBadgeProps {
  status: SlaStatusValue | null;
  timeLeft: string | null;
}

export function SlaBadge({ status, timeLeft }: SlaBadgeProps) {
  if (!status || status === "ok") return null;

  if (status === "breached") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="border-red-500 bg-red-50 text-red-700 text-xs">
              🔴 SLA violado
            </Badge>
          </TooltipTrigger>
          <TooltipContent><p>O prazo de SLA foi estourado</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="border-yellow-500 bg-yellow-50 text-yellow-700 text-xs">
            ⏱️ SLA: {timeLeft ?? "em risco"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent><p>SLA em risco — {timeLeft} restante</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
