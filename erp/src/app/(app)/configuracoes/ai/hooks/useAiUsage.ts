"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { getAiUsageSummary, getTodaySpendAction } from "../actions";
import type { UsageSummary } from "../components/types";

export function useAiUsage(companyId: string | null) {
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [todaySpend, setTodaySpend] = useState<number>(0);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const loadUsageData = useCallback(async () => {
    if (!companyId) return;
    setLoadingUsage(true);
    try {
      const [summary, spend] = await Promise.all([
        getAiUsageSummary(companyId, 30),
        getTodaySpendAction(companyId),
      ]);
      setUsageSummary(summary);
      setTodaySpend(spend);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar consumo",
      );
    } finally {
      setLoadingUsage(false);
    }
  }, [companyId]);

  return {
    usageSummary,
    todaySpend,
    loadingUsage,
    loadUsageData,
  };
}
