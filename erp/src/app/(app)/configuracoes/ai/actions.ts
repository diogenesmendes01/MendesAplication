"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { encrypt, decrypt } from "@/lib/encryption";
import { chatCompletion } from "@/lib/ai/provider";
import { getTodaySpend, getUsageSummary, type UsageSummary } from "@/lib/ai/cost-tracker";
import { suggestModel } from "@/lib/ai/model-suggester";
import { runAgentDryRun, type DryRunResult } from "@/lib/ai/agent";
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

export interface ModelSuggestionData {
  model: string;
  estimatedDailyCostBrl: number;
}

export interface SimulationResult {
  response: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostBrl: number;
  error?: string;
}

export type { UsageSummary };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a secret string: show only the last 4 chars, replace the rest with ****.
 * Returns empty string for null/undefined/empty input.
 *
 * ⚠️  KNOWN LIMITATION — DECRYPT-ON-READ:
 * This function decrypts the full API key on every call to getAiConfig()
 * (including polling from Settings tabs and the Consumo tab). This results
 * in unnecessary decrypt operations and silently returns "" for null keys,
 * which can mask unconfigured keys in the frontend.
 *
 * TODO(#104): Refactor updateAiConfig to persist apiKeyHint = plaintext.slice(-4)
 * in a new AiConfig.apiKeyHint column, then return `****${record.apiKeyHint}`
 * here without decrypting. Requires migration — see linked issue.
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
// Rate limiter for testAiConnection (in-memory, per-company, max 5/min)
//
// ⚠️  KNOWN LIMITATION — IN-MEMORY ONLY (same as simulationRateMap above).
// TODO: Replace with Redis-backed counter when available.
// ---------------------------------------------------------------------------

const testConnectionRateMap = new Map<string, number[]>();
const TEST_CONN_RATE_LIMIT = 5;
const TEST_CONN_RATE_WINDOW_MS = 60_000; // 1 minute

function checkTestConnectionRateLimit(companyId: string): boolean {
  const now = Date.now();
  const timestamps = testConnectionRateMap.get(companyId) ?? [];
  const recent = timestamps.filter((ts) => now - ts < TEST_CONN_RATE_WINDOW_MS);
  if (recent.length >= TEST_CONN_RATE_LIMIT) {
    testConnectionRateMap.set(companyId, recent);
    return false; // rate limited
  }
  recent.push(now);
  testConnectionRateMap.set(companyId, recent);
  return true; // allowed
}

// ---------------------------------------------------------------------------
// Rate limiter for simulation (in-memory, per-company, max 10/min)
//
// ⚠️  KNOWN LIMITATION — IN-MEMORY ONLY:
// This Map lives in the Node.js process heap. In serverless/edge deployments
// (Vercel Functions, AWS Lambda) or multi-pod Kubernetes setups, each
// instance has its own independent Map — so N replicas effectively allow
// N × 10 requests/min, making this rate limiter useless for real protection.
//
// TODO: Replace with a Redis-backed counter when Redis/Upstash is available.
//   Suggested key: `sim_rate:{companyId}` (INCR + EXPIRE 60s via pipeline).
//   Reference: https://upstash.com/docs/redis/sdks/ts/commands/incr
//
// Until then, the conservative limit (10/min) reduces risk on single-instance
// deployments and the real protection remains the requireAdmin() auth check.
// ---------------------------------------------------------------------------

const simulationRateMap = new Map<string, number[]>();
const SIMULATION_RATE_LIMIT = 10;
const SIMULATION_RATE_WINDOW_MS = 60_000; // 1 minute

function checkSimulationRateLimit(companyId: string): boolean {
  const now = Date.now();
  const timestamps = simulationRateMap.get(companyId) ?? [];

  // Remove entries older than the window
  const recent = timestamps.filter((ts) => now - ts < SIMULATION_RATE_WINDOW_MS);

  if (recent.length >= SIMULATION_RATE_LIMIT) {
    simulationRateMap.set(companyId, recent);
    return false; // rate limited
  }

  recent.push(now);
  simulationRateMap.set(companyId, recent);
  return true; // allowed
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

const VALID_PROVIDERS = ["openai", "anthropic", "grok", "qwen", "deepseek"] as const;

export async function updateAiConfig(
  companyId: string,
  data: AiConfigData,
): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);

  // Server-side validation — frontend HTML attributes are not a security boundary
  if (
    typeof data.temperature !== "number" ||
    data.temperature < 0 ||
    data.temperature > 1
  ) {
    throw new Error("temperature must be a number between 0 and 1");
  }
  if (
    typeof data.maxIterations !== "number" ||
    !Number.isInteger(data.maxIterations) ||
    data.maxIterations < 1 ||
    data.maxIterations > 10
  ) {
    throw new Error("maxIterations must be an integer between 1 and 10");
  }
  if (!VALID_PROVIDERS.includes(data.provider as typeof VALID_PROVIDERS[number])) {
    throw new Error(
      `provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
    );
  }
  if (
    data.dailySpendLimitBrl !== null &&
    (typeof data.dailySpendLimitBrl !== "number" || data.dailySpendLimitBrl <= 0)
  ) {
    throw new Error("dailySpendLimitBrl must be a positive number or null");
  }

  // Determine the apiKey to store:
  // - If the incoming apiKey is empty or looks masked (starts with ****), keep existing
  // - Otherwise, encrypt the new value
  let apiKeyToStore: string | undefined;
  if (data.apiKey && !data.apiKey.startsWith("****")) {
    apiKeyToStore = encrypt(data.apiKey);
  }

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
 */
export async function testAiConnection(
  companyId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  if (!checkTestConnectionRateLimit(companyId)) {
    return { ok: false, error: "Limite de testes atingido (máx 5/min). Aguarde um momento." };
  }

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
 */
export async function getAiUsageSummary(
  companyId: string,
  days: number,
): Promise<UsageSummary> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  return getUsageSummary(companyId, days);
}

/**
 * Get today's spend for the company (BRL).
 */
export async function getTodaySpendAction(
  companyId: string,
): Promise<number> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  return getTodaySpend(companyId);
}

/**
 * Get model suggestion based on provider and daily budget.
 */
export async function getSuggestedModel(
  provider: string,
  dailyBudgetBrl: number,
): Promise<ModelSuggestionData> {
  await requireAdmin();
  return suggestModel(provider, dailyBudgetBrl);
}

/**
 * Simulate an AI response in dry-run mode.
 * Uses the real persona and knowledge base but does NOT send messages or save to DB.
 * Rate limited to 10 simulations per minute per company.
 */
export async function simulateAiResponse(
  companyId: string,
  message: string,
  channel: "WHATSAPP" | "EMAIL",
): Promise<SimulationResult> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  // Input validation
  if (!message || message.trim().length === 0) {
    return {
      response: "",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostBrl: 0,
      error: "Mensagem não pode ser vazia",
    };
  }

  if (message.length > 2000) {
    return {
      response: "",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostBrl: 0,
      error: "Mensagem muito longa (máximo 2000 caracteres)",
    };
  }

  // Rate limit check
  if (!checkSimulationRateLimit(companyId)) {
    return {
      response: "",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostBrl: 0,
      error: "Limite de simulações atingido (máx 10/min). Aguarde um momento.",
    };
  }

  // Run the agent in dry-run mode
  const result: DryRunResult = await runAgentDryRun(
    companyId,
    message.trim(),
    channel,
  );

  return {
    response: result.response,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    estimatedCostBrl: result.estimatedCostBrl,
    error: result.error,
  };
}
