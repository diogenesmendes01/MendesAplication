"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { getAiConfig, updateAiConfig } from "../actions";
import { DEFAULT_CONFIG, type AiConfigData } from "../components/types";

export function useAiConfig(companyId: string | null) {
  const [config, setConfig] = useState<AiConfigData>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<AiConfigData>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const hasUnsavedChanges =
    !loading && JSON.stringify(config) !== JSON.stringify(savedConfig);

  const loadData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await getAiConfig(companyId);
      setConfig(data);
      setSavedConfig(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar configurações",
      );
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = useCallback(async () => {
    if (!companyId) return;

    if (config.dailySpendLimitBrl !== null && config.dailySpendLimitBrl <= 0) {
      toast.error("O limite de gasto diário deve ser um valor positivo (maior que zero).");
      return;
    }

    setSaving(true);
    try {
      await updateAiConfig(companyId, config);
      setSavedConfig(config);
      toast.success("Configurações do Agente IA salvas com sucesso");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }, [companyId, config]);

  return {
    config,
    setConfig,
    loading,
    saving,
    hasUnsavedChanges,
    handleSave,
  };
}
