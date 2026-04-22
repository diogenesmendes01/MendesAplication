/**
 * AI Provider Health Checker
 */

import { prisma } from "@/lib/prisma";
import { chatCompletion } from "./provider";
import type { ProviderConfig } from "./provider";
import { sseBus } from "@/lib/sse";
import { logger } from "@/lib/logger";

const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const DEGRADED_LATENCY_MS = 5_000;

export type ProviderStatus = "up" | "down" | "degraded";

export interface HealthCheckResult {
  provider: string;
  model: string;
  status: ProviderStatus;
  latencyMs: number | null;
  errorMessage: string | null;
}

export interface ProviderHealthEntry {
  provider: string;
  model: string;
  apiKey: string;
}

export async function checkProviderHealth(
  entry: ProviderHealthEntry,
): Promise<HealthCheckResult> {
  const { provider, model, apiKey } = entry;
  const startTime = Date.now();
  let status: ProviderStatus = "up";
  let errorMessage: string | null = null;
  let latencyMs: number | null = null;

  try {
    const config: ProviderConfig = {
      provider, apiKey, model, maxTokens: 5, temperature: 0,
    };
    await Promise.race([
      chatCompletion([{ role: "user", content: "Reply with OK." }], undefined, config),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), HEALTH_CHECK_TIMEOUT_MS)),
    ]);
    latencyMs = Date.now() - startTime;
    status = latencyMs > DEGRADED_LATENCY_MS ? "degraded" : "up";
  } catch (error) {
    latencyMs = Date.now() - startTime;
    status = "down";
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  return { provider, model, status, latencyMs, errorMessage };
}

export async function getPreviousStatus(
  provider: string, model: string,
): Promise<ProviderStatus | null> {
  const last = await prisma.aiProviderHealth.findFirst({
    where: { provider, model },
    orderBy: { checkedAt: "desc" },
    select: { status: true },
  });
  return (last?.status as ProviderStatus) ?? null;
}

export async function recordHealthCheck(result: HealthCheckResult): Promise<void> {
  await prisma.aiProviderHealth.create({
    data: {
      provider: result.provider, model: result.model, status: result.status,
      latencyMs: result.latencyMs, errorMessage: result.errorMessage,
    },
  });
}

export async function handleProviderDown(
  provider: string, model: string, errorMessage: string | null,
): Promise<void> {
  logger.warn({ provider, model, error: errorMessage }, "[health-check] Provider DOWN");
  await prisma.aiProviderIncident.create({ data: { provider, model, startedAt: new Date() } });
  const allDown = await areAllProvidersDown();
  if (allDown) await activateHumanOnlyMode();
  const companies = await getCompaniesUsingProvider(provider);
  for (const companyId of companies) {
    sseBus.publish(`company:${companyId}:system`, "ai-provider-down", { provider, model, error: errorMessage, allDown });
  }
}

export async function handleProviderUp(provider: string, model: string): Promise<void> {
  logger.info({ provider, model }, "[health-check] Provider UP");
  const incident = await prisma.aiProviderIncident.findFirst({
    where: { provider, model, resolvedAt: null }, orderBy: { startedAt: "desc" },
  });
  if (incident) {
    const durationMs = Date.now() - incident.startedAt.getTime();
    await prisma.aiProviderIncident.update({ where: { id: incident.id }, data: { resolvedAt: new Date(), durationMs } });
  }
  await deactivateHumanOnlyMode();
  const companies = await getCompaniesUsingProvider(provider);
  for (const companyId of companies) {
    sseBus.publish(`company:${companyId}:system`, "ai-provider-up", { provider, model });
  }
}

export async function runHealthCheckCycle(): Promise<HealthCheckResult[]> {
  const providers = await getConfiguredProviders();
  const results: HealthCheckResult[] = [];
  for (const entry of providers) {
    const prev = await getPreviousStatus(entry.provider, entry.model);
    const result = await checkProviderHealth(entry);
    await recordHealthCheck(result);
    if (prev === "up" && result.status === "down") await handleProviderDown(result.provider, result.model, result.errorMessage);
    else if (prev === "down" && (result.status === "up" || result.status === "degraded")) await handleProviderUp(result.provider, result.model);
    results.push(result);
  }
  return results;
}

export async function activateHumanOnlyMode(): Promise<void> {
  await prisma.aiConfig.updateMany({ where: { humanOnlyModeEnabled: false }, data: { humanOnlyModeEnabled: true } });
  logger.warn("[fallback] Human-only mode ACTIVATED");
}

export async function deactivateHumanOnlyMode(): Promise<void> {
  const statuses = await getLatestProviderStatuses();
  if (!statuses.every((s) => s.status !== "down")) return;
  await prisma.aiConfig.updateMany({ where: { humanOnlyModeEnabled: true }, data: { humanOnlyModeEnabled: false } });
  logger.info("[fallback] Human-only mode DEACTIVATED");
}

export async function getConfiguredProviders(): Promise<ProviderHealthEntry[]> {
  const configs = await prisma.aiConfig.findMany({
    where: { enabled: true, apiKey: { not: null } },
    select: { provider: true, model: true, apiKey: true },
    distinct: ["provider", "model"],
  });
  const { decrypt } = await import("@/lib/encryption");
  return configs.filter((c) => c.apiKey).map((c) => ({
    provider: c.provider,
    model: c.model || "gpt-4o-mini",
    apiKey: decrypt(c.apiKey!),
  }));
}

export async function getCompaniesUsingProvider(provider: string): Promise<string[]> {
  const configs = await prisma.aiConfig.findMany({
    where: { provider, enabled: true }, select: { companyId: true }, distinct: ["companyId"],
  });
  return configs.map((c) => c.companyId);
}

export async function areAllProvidersDown(): Promise<boolean> {
  const statuses = await getLatestProviderStatuses();
  if (statuses.length === 0) return false;
  return statuses.every((s) => s.status === "down");
}

export async function getLatestProviderStatuses(): Promise<
  { provider: string; model: string; status: string; latencyMs: number | null; checkedAt: Date }[]
> {
  return prisma.aiProviderHealth.findMany({
    distinct: ["provider", "model"],
    orderBy: { checkedAt: "desc" },
    select: { provider: true, model: true, status: true, latencyMs: true, checkedAt: true },
  });
}

export async function cleanupOldHealthChecks(retainDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000);
  const result = await prisma.aiProviderHealth.deleteMany({ where: { checkedAt: { lt: cutoff } } });
  return result.count;
}
