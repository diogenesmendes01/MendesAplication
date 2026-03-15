"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { encrypt, decrypt } from "@/lib/encryption";
import { chatCompletion } from "@/lib/ai/provider";
import { getUsageSummary, type UsageSummary } from "@/lib/ai/cost-tracker";
import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiConfigData {
  enabled: boolean;
  persona: string;
  welcomeMessage: string;
  escalationKeywords: string[];
  maxIterations: number;
  // Provider
  provider: string;
  apiKey: string; // masked on read, plain on write
  model: string;
  // Channels
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  emailPersona: string;
  emailSignature: string;
  // Limits
  dailySpendLimitBrl: number | null;
  // Temperature
  temperature: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a secret string: show only the last 4 chars, replace the rest with ****.
 * Returns empty string for null/undefined/empty input.
 */
function maskApiKey(key: string | null | undefined): string {
  if (!key) return "";
  try {
    const decrypted = decrypt(key);
    if (decrypted.length > 4) {
      return `****${decrypted.slice(-4)}`;
    }
    return "****";
  } catch {
    // If decryption fails (e.g., not encrypted yet), mask the raw value
    if (key.length > 4) {
      return `****${key.slice(-4)}`;
    }
    return "****";
  }
}

// ---------------------------------------------------------------------------
// Hardcoded model lists for providers that don't have a list endpoint
// ---------------------------------------------------------------------------

const HARDCODED_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-20250414",
  ],
  grok: ["grok-2", "grok-2-mini"],
  qwen: ["qwen-max", "qwen-plus", "qwen-turbo"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function getAiConfig(companyId: string): Promise<AiConfigData> {
  await requireCompanyAccess(companyId);

  const config = await prisma.aiConfig.findUnique({
    where: { companyId },
  });

  if (!config) {
    return {
      enabled: false,
      persona: "",
      welcomeMessage: "",
      escalationKeywords: [],
      maxIterations: 5,
      provider: "openai",
      apiKey: "",
      model: "",
      whatsappEnabled: true,
      emailEnabled: false,
      emailPersona: "",
      emailSignature: "",
      dailySpendLimitBrl: null,
      temperature: 0.7,
    };
  }

  return {
    enabled: config.enabled,
    persona: config.persona,
    welcomeMessage: config.welcomeMessage ?? "",
    escalationKeywords: config.escalationKeywords,
    maxIterations: config.maxIterations,
    provider: config.provider,
    apiKey: maskApiKey(config.apiKey),
    model: config.model ?? "",
    whatsappEnabled: config.whatsappEnabled,
    emailEnabled: config.emailEnabled,
    emailPersona: config.emailPersona ?? "",
    emailSignature: config.emailSignature ?? "",
    dailySpendLimitBrl: config.dailySpendLimitBrl
      ? Number(config.dailySpendLimitBrl)
      : null,
    temperature: config.temperature,
  };
}

export async function updateAiConfig(
  companyId: string,
  data: AiConfigData,
): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);

  // Determine the apiKey to store:
  // - If the incoming apiKey is empty or looks masked (starts with ****), keep existing
  // - Otherwise, encrypt the new value
  let apiKeyToStore: string | undefined;
  if (data.apiKey && !data.apiKey.startsWith("****")) {
    apiKeyToStore = encrypt(data.apiKey);
  }

  // If apiKeyToStore is undefined, we need to preserve the existing value
  // Build the update data without apiKey first, then conditionally add it
  const baseData = {
    enabled: data.enabled,
    persona: data.persona,
    welcomeMessage: data.welcomeMessage || null,
    escalationKeywords: data.escalationKeywords,
    maxIterations: data.maxIterations,
    provider: data.provider,
    model: data.model || null,
    whatsappEnabled: data.whatsappEnabled,
    emailEnabled: data.emailEnabled,
    emailPersona: data.emailPersona || null,
    emailSignature: data.emailSignature || null,
    dailySpendLimitBrl: data.dailySpendLimitBrl,
    temperature: data.temperature,
  };

  const createData = {
    companyId,
    ...baseData,
    apiKey: apiKeyToStore ?? null,
  };

  const updateData = apiKeyToStore !== undefined
    ? { ...baseData, apiKey: apiKeyToStore }
    : baseData;

  await prisma.aiConfig.upsert({
    where: { companyId },
    create: createData,
    update: updateData,
  });

  // Audit log — redact apiKey from the logged data
  const auditData = {
    ...data,
    apiKey: data.apiKey ? "(redacted)" : "(empty)",
  };

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "AiConfig",
    entityId: companyId,
    dataAfter: auditData as unknown as Prisma.InputJsonValue,
    companyId,
  });
}

/**
 * Test the AI connection for a company by making a minimal API call.
 * Decrypts the stored apiKey, sends a trivial prompt, and returns success/failure.
 */
export async function testAiConnection(
  companyId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  const config = await prisma.aiConfig.findUnique({
    where: { companyId },
  });

  if (!config?.apiKey) {
    return { ok: false, error: "API key não configurada" };
  }

  let apiKey: string;
  try {
    apiKey = decrypt(config.apiKey);
  } catch {
    return { ok: false, error: "Falha ao descriptografar a API key" };
  }

  try {
    await chatCompletion(
      [{ role: "user", content: "Hi" }],
      undefined,
      {
        provider: config.provider,
        apiKey,
        model: config.model ?? undefined,
        maxTokens: 5,
      },
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return { ok: false, error: message };
  }
}

/**
 * List available models for the company's configured provider.
 * For OpenAI: calls /v1/models with the stored apiKey.
 * For other providers: returns a hardcoded list.
 */
export async function listAvailableModels(
  companyId: string,
): Promise<string[]> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  const config = await prisma.aiConfig.findUnique({
    where: { companyId },
  });

  const provider = config?.provider ?? "openai";

  // For non-OpenAI providers, return hardcoded list
  if (provider !== "openai") {
    return HARDCODED_MODELS[provider] ?? [];
  }

  // For OpenAI: try to fetch from API
  if (!config?.apiKey) {
    // No key stored — return a sensible default list
    return ["gpt-4o", "gpt-4o-mini"];
  }

  let apiKey: string;
  try {
    apiKey = decrypt(config.apiKey);
  } catch {
    return ["gpt-4o", "gpt-4o-mini"];
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return ["gpt-4o", "gpt-4o-mini"];
    }

    const data = await res.json();
    const models: string[] = (data.data ?? [])
      .map((m: { id: string }) => m.id)
      .filter(
        (id: string) =>
          id.startsWith("gpt-") &&
          !id.includes("instruct") &&
          !id.includes("realtime") &&
          !id.includes("audio"),
      )
      .sort();

    return models.length > 0 ? models : ["gpt-4o", "gpt-4o-mini"];
  } catch {
    return ["gpt-4o", "gpt-4o-mini"];
  }
}

/**
 * Get AI usage summary for the frontend consumption tab.
 * Returns aggregated data for the last N days.
 */
export async function getAiUsageSummary(
  companyId: string,
  days: number,
): Promise<UsageSummary> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  return getUsageSummary(companyId, days);
}
