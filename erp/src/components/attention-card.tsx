"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardAlert } from "@/app/(app)/dashboard/actions";

interface AttentionCardProps {
  alerts: DashboardAlert[];
  className?: string;
}

export function AttentionCard({ alerts, className }: AttentionCardProps) {
  if (alerts.length === 0) return null;

  const totalCount = alerts.reduce((sum, a) => sum + a.count, 0);

  return (
    <div
      className={cn(
        "rounded-xl border border-warning/30 bg-warning-subtle p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-[18px] w-[18px] text-warning" />
        <span className="text-sm font-semibold text-text-primary">
          {totalCount} {totalCount === 1 ? "item precisa" : "itens precisam"} de atenção
        </span>
      </div>

      {/* Alert list */}
      <ul className="space-y-2">
        {alerts.map((alert, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1.5 flex-shrink-0 rounded-full h-2 w-2",
                alert.severity === "critical" ? "bg-danger" : "bg-warning"
              )}
            />
            <div className="flex-1 min-w-0">
              <span className="text-body-sm font-medium text-text-primary">
                [{alert.type === "SLA_BREACH" || alert.type === "SLA_RISK"
                  ? "SAC"
                  : alert.type === "BOLETO_VENCIDO"
                  ? "Financeiro"
                  : alert.type === "NFSE_FAILED"
                  ? "Fiscal"
                  : "Comercial"}]{" "}
                {alert.title}
              </span>
            </div>
            <a
              href={alert.href}
              className="flex-shrink-0 text-caption text-accent hover:text-accent-hover underline whitespace-nowrap"
            >
              Ver →
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
