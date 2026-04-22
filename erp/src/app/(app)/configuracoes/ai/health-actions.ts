"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { encrypt as _encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderHealthStatus {
  provider: string;
  model: string;
  status: string;
  latencyMs: number | null;
  checkedAt: string;
}

export interface ProviderHealthHistoryEntry {
  id: string;
  provider: string;
  model: string;
  status: string;
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

export interface ProviderIncident {
  id: string;
  provider: string;
  model: string;
  startedAt: string;
  resolvedAt: string | null;
  durationMs: number | null;
  ticketsAffected: number;
  ticketsRecovered: number;
}

export interface FallbackChainEntry {
  provider: string;
  model: string;
}

export interface HealthDashboardData {
  statuses: ProviderHealthStatus[];
  incidents: ProviderIncident[];
  pendingRecoveryCount: number;
  humanOnlyMode: boolean;
  fallbackChain: FallbackChainEntry[];
  healthCheckEnabled: boolean;
}

// ---------------------------------------------------------------------------
// getProviderHealth — current status of all providers
// ---------------------------------------------------------------------------

export async function getProviderHealth(
  companyId: string,
): Promise<HealthDashboardData> {
  await requireCompanyAccess(companyId);

  // Get latest status per provider/model
  const statuses = await prisma.aiProviderHealth.findMany({
    distinct: ["provider", "model"],
    orderBy: { checkedAt: "desc" },
    select: {
      provider: true,
      model: true,
      status: true,
      latencyMs: true,
      checkedAt: true,
    },
  });

  // Get recent incidents (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const incidents = await prisma.aiProviderIncident.findMany({
    where: { createdAt: { gte: thirtyDaysAgo } },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  // Get pending recovery count
  const pendingRecoveryCount = await prisma.ticket.count({
    where: { aiPendingRecovery: true, companyId },
  });

  // Get company AI config for fallback chain & human-only mode
  const aiConfig = await prisma.aiConfig.findFirst({
    where: { companyId, channel: null },
    select: {
      humanOnlyModeEnabled: true,
      fallbackChain: true,
      healthCheckEnabled: true,
    },
  });

  const fallbackChain = (aiConfig?.fallbackChain as FallbackChainEntry[] | null) ?? [];

  return {
    statuses: statuses.map((s) => ({
      ...s,
      checkedAt: s.checkedAt.toISOString(),
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      provider: i.provider,
      model: i.model,
      startedAt: i.startedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      durationMs: i.durationMs,
      ticketsAffected: i.ticketsAffected,
      ticketsRecovered: i.ticketsRecovered,
    })),
    pendingRecoveryCount,
    humanOnlyMode: aiConfig?.humanOnlyModeEnabled ?? false,
    fallbackChain,
    healthCheckEnabled: aiConfig?.healthCheckEnabled ?? true,
  };
}

// ---------------------------------------------------------------------------
// getProviderHistory — health check history for charts
// ---------------------------------------------------------------------------

export async function getProviderHistory(
  companyId: string,
  hours = 24,
): Promise<ProviderHealthHistoryEntry[]> {
  await requireCompanyAccess(companyId);

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const history = await prisma.aiProviderHealth.findMany({
    where: { checkedAt: { gte: since } },
    orderBy: { checkedAt: "asc" },
    select: {
      id: true,
      provider: true,
      model: true,
      status: true,
      latencyMs: true,
      errorMessage: true,
      checkedAt: true,
    },
  });

  return history.map((h) => ({
    ...h,
    checkedAt: h.checkedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// configFallbackChain — update fallback chain configuration
// ---------------------------------------------------------------------------

export async function configFallbackChain(
  companyId: string,
  chain: FallbackChainEntry[],
  healthCheckEnabled?: boolean,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);

  // Validate chain entries
  const validProviders = ["openai", "anthropic", "deepseek", "grok", "qwen"];
  for (const entry of chain) {
    if (!validProviders.includes(entry.provider)) {
      return { success: false, error: `Provider inválido: ${entry.provider}` };
    }
    if (!entry.model || entry.model.trim().length === 0) {
      return { success: false, error: "Modelo não pode ser vazio" };
    }
  }

  try {
    const data: Record<string, unknown> = {
      fallbackChain: chain.length > 0 ? chain : null,
    };
    if (healthCheckEnabled !== undefined) {
      data.healthCheckEnabled = healthCheckEnabled;
    }

    await prisma.aiConfig.updateMany({
      where: { companyId, channel: null },
      data,
    });

    await logAuditEvent({
      action: "ai_fallback_chain_updated",
      userId: session.userId,
      entity: "aiConfig",
      entityId: companyId,
      companyId,
      dataAfter: { chain, healthCheckEnabled } as unknown as import("@prisma/client").Prisma.InputJsonValue,
    });

    logger.info(
      { companyId, chainLength: chain.length, healthCheckEnabled },
      "[health-actions] Fallback chain updated",
    );

    return { success: true };
  } catch (error) {
    logger.error({ companyId, error }, "[health-actions] Failed to update fallback chain");
    return { success: false, error: "Erro ao salvar configuração" };
  }
}
