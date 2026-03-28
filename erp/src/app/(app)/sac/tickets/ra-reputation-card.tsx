"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertCircle, Award, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getRaReputation } from "./ra-actions";
import type { RaReputationResult, RaReputationData } from "./ra-actions.types";

// ---------------------------------------------------------------------------
// Selo / Badge Config
// ---------------------------------------------------------------------------

type SeloConfig = {
  label: string;
  bg: string;
  text: string;
  border: string;
};

const SELO_MAP: Record<string, SeloConfig> = {
  RA1000: {
    label: "RA 1000",
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-800 dark:text-amber-200",
    border: "border-amber-300 dark:border-amber-700",
  },
  OTIMO: {
    label: "Ótimo",
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-800 dark:text-emerald-200",
    border: "border-emerald-300 dark:border-emerald-700",
  },
  BOM: {
    label: "Bom",
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-800 dark:text-blue-200",
    border: "border-blue-300 dark:border-blue-700",
  },
  REGULAR: {
    label: "Regular",
    bg: "bg-yellow-100 dark:bg-yellow-900/40",
    text: "text-yellow-800 dark:text-yellow-200",
    border: "border-yellow-300 dark:border-yellow-700",
  },
  RUIM: {
    label: "Ruim",
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-800 dark:text-red-200",
    border: "border-red-300 dark:border-red-700",
  },
  NAO_RECOMENDADA: {
    label: "Não Recomendada",
    bg: "bg-red-200 dark:bg-red-950/60",
    text: "text-red-900 dark:text-red-300",
    border: "border-red-400 dark:border-red-800",
  },
  SEM_INDICE: {
    label: "Sem Índice",
    bg: "bg-gray-100 dark:bg-gray-800/40",
    text: "text-gray-600 dark:text-gray-400",
    border: "border-gray-300 dark:border-gray-700",
  },
};

function getSeloConfig(reputationCode: string): SeloConfig {
  // RA API returns codes like "RA1000", "OTIMO", "BOM", "REGULAR", "RUIM",
  // "NAO_RECOMENDADA", "SEM_INDICE" — normalize to uppercase
  const normalized = reputationCode.toUpperCase().replace(/\s+/g, "_");
  return SELO_MAP[normalized] ?? SELO_MAP.SEM_INDICE;
}

// ---------------------------------------------------------------------------
// Period Alias Map
// ---------------------------------------------------------------------------

const PERIOD_LABELS: Record<string, string> = {
  SEISMESES: "Últimos 6 meses",
  DOZEMESES: "Últimos 12 meses",
  UMANOATRAS: "1 ano atrás",
  DOISANOSATRAS: "2 anos atrás",
  GERAL: "Geral",
};

function periodLabel(periodKey: string): string {
  return PERIOD_LABELS[periodKey] ?? periodKey;
}

// ---------------------------------------------------------------------------
// Metric Row
// ---------------------------------------------------------------------------

function MetricRow({
  label,
  value,
  suffix,
  showProgress,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  showProgress?: boolean;
}) {
  const numericValue = typeof value === "number" ? value : parseFloat(String(value));
  const displayValue =
    typeof value === "number"
      ? value % 1 === 0
        ? value.toString()
        : value.toFixed(1)
      : String(value);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {displayValue}
          {suffix}
        </span>
      </div>
      {showProgress && !isNaN(numericValue) && (
        <Progress value={Math.min(numericValue, 100)} className="h-1.5" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function ReputationSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-muted animate-pulse" />
          <div className="h-5 w-48 rounded bg-muted animate-pulse" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-xl bg-muted animate-pulse" />
          <div className="space-y-2 flex-1">
            <div className="h-6 w-24 rounded bg-muted animate-pulse" />
            <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          </div>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between">
              <div className="h-4 w-28 rounded bg-muted animate-pulse" />
              <div className="h-4 w-12 rounded bg-muted animate-pulse" />
            </div>
            <div className="h-1.5 w-full rounded bg-muted animate-pulse" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Period Card (reusable for each period)
// ---------------------------------------------------------------------------

function PeriodMetrics({
  period,
}: {
  period: RaReputationData["periods"][number];
}) {
  const selo = getSeloConfig(period.reputationCode);

  return (
    <div className="space-y-4">
      {/* Selo + Grade */}
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "flex h-16 w-16 flex-col items-center justify-center rounded-xl border-2 font-bold",
            selo.bg,
            selo.text,
            selo.border
          )}
        >
          <span className="text-2xl leading-none tabular-nums">
            {period.finalGrade % 1 === 0
              ? period.finalGrade
              : period.finalGrade.toFixed(1)}
          </span>
          <span className="text-[10px] font-medium leading-tight mt-0.5">
            nota
          </span>
        </div>
        <div>
          <Badge
            variant="outline"
            className={cn(
              "text-sm font-semibold px-3 py-1",
              selo.bg,
              selo.text,
              selo.border
            )}
          >
            <Award className="mr-1 h-3.5 w-3.5" />
            {selo.label}
          </Badge>
          <p className="text-xs text-muted-foreground mt-1">
            {period.reputationName || selo.label}
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="space-y-3">
        <MetricRow
          label="Respondidas"
          value={period.responseIndex}
          suffix="%"
          showProgress
        />
        <MetricRow
          label="Resolvidas"
          value={period.solutionsPercentage}
          suffix="%"
          showProgress
        />
        <MetricRow
          label="Nota média"
          value={period.avgGrade}
          suffix="/10"
        />
        <MetricRow
          label="Total de reclamações"
          value={period.complaintsCount}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function RaReputationCard({ companyId }: { companyId: string }) {
  const [result, setResult] = useState<RaReputationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("SEISMESES");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRaReputation(companyId);
      setResult(res);

      // Default to SEISMESES if available
      if (res.success && res.data?.periods.length) {
        const hasSeisMeses = res.data.periods.some(
          (p) => p.periodKey === "SEISMESES"
        );
        setSelectedPeriod(
          hasSeisMeses ? "SEISMESES" : res.data.periods[0].periodKey
        );
      }
    } catch {
      setResult({ success: false, error: "Erro ao carregar reputação" });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // If loading, show skeleton
  if (loading) return <ReputationSkeleton />;

  // If error contains "não configurado" → no RA channel, don't render
  if (
    !result?.success &&
    result?.error?.toLowerCase().includes("não configurado")
  ) {
    return null;
  }

  // Other errors → show error state
  if (!result?.success) {
    return (
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            📊 Reputação Reclame Aqui
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{result?.error ?? "Erro ao carregar dados"}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No data
  if (!result.data || result.data.periods.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            📊 Reputação Reclame Aqui
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nenhum dado de reputação disponível.
          </p>
        </CardContent>
      </Card>
    );
  }

  const activePeriod = result.data.periods.find(
    (p) => p.periodKey === selectedPeriod
  );

  // Only show main periods (6m, 12m)
  const visiblePeriods = result.data.periods.filter((p) =>
    ["SEISMESES", "DOZEMESES"].includes(p.periodKey)
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Reputação Reclame Aqui
          </CardTitle>
        </div>

        {/* Period Tabs */}
        {visiblePeriods.length > 1 && (
          <div className="flex gap-1 mt-2">
            {visiblePeriods.map((p) => (
              <button
                key={p.periodKey}
                onClick={() => setSelectedPeriod(p.periodKey)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  selectedPeriod === p.periodKey
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {periodLabel(p.periodKey)}
              </button>
            ))}
          </div>
        )}

        {/* Single period label */}
        {visiblePeriods.length === 1 && (
          <p className="text-xs text-muted-foreground mt-1">
            {periodLabel(visiblePeriods[0].periodKey)}
          </p>
        )}
      </CardHeader>

      <CardContent>
        {activePeriod ? (
          <PeriodMetrics period={activePeriod} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Período não disponível.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
