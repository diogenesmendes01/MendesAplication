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
  emailPersona: string | null;
  emailSignature: string | null;
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
  /**
   * Informational note for the UI: simulation calls are logged in AiUsageLog
   * (visible in Consumo de IA) but are marked isSimulation=true and excluded
   * from getTodaySpend() — they do NOT count against the daily budget limit.
   */
  simulationWarning?: string;
}

export type { UsageSummary };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a fully opaque mask (`"****"`) for any non-empty API key value.
 * Returns empty string for null / undefined / empty input.
 *
 * The function intentionally does NOT decrypt the stored ciphertext —
 * it simply signals "a key is configured" without exposing any key material.
 *
 * When apiKeyHint is available (last 4 chars stored on save),
 * returns `****${hint}` for user-friendly identification.
 */
function maskApiKey(key: string | null | undefined, hint?: string | null): string {
  if (!key) return "";
  if (hint) return `****${hint}`;
  return "****";
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

  // Prune stale key when all timestamps have expired to avoid unbounded memory growth
  if (recent.length === 0 && testConnectionRateMap.has(companyId)) {
    testConnectionRateMap.delete(companyId);
  }

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

  // Prune stale key when all timestamps have expired to avoid unbounded memory growth
  if (recent.length === 0 && simulationRateMap.has(companyId)) {
    simulationRateMap.delete(companyId);
  }

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
    apiKey: maskApiKey(config.apiKey, (config as unknown as { apiKeyHint?: string }).apiKeyHint),
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

/**
 * Pattern that identifies a masked API key returned by maskApiKey().
 * Masked keys always start with four asterisks (e.g. "****ab12").
 * Using a regex constant makes the intent explicit and avoids fragile
 * string comparisons scattered across the codebase.
 */
const MASKED_API_KEY_PATTERN = /^\*{4}/;

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
    (typeof data.dailySpendLimitBrl !== "number" || !Number.isFinite(data.dailySpendLimitBrl) || data.dailySpendLimitBrl <= 0)
  ) {
    throw new Error("dailySpendLimitBrl must be a positive number or null");
  }

  // Validate free-text fields to prevent oversized system prompts
  // that could exceed provider token limits (~4 000–8 000 token system prompt ceiling)
  if (!data.persona || data.persona.trim().length === 0) {
    throw new Error("persona cannot be empty");
  }
  if (data.persona.length > 5000) {
    throw new Error("persona too long (max 5000 characters)");
  }
  if (data.welcomeMessage && data.welcomeMessage.length > 1000) {
    throw new Error("welcomeMessage too long (max 1000 characters)");
  }
  if (data.emailPersona && data.emailPersona.length > 5000) {
    throw new Error("emailPersona too long (max 5000 characters)");
  }
  if (data.emailSignature && data.emailSignature.length > 1000) {
    throw new Error("emailSignature too long (max 1000 characters)");
  }

  // Determine the apiKey to store:
  // - If incoming apiKey is null → explicit removal: clear key and zero the hint
  // - If the incoming apiKey is empty string or matches the masked pattern, keep existing
  // - Otherwise, validate and encrypt the new value and persist the last-4-char hint
  let apiKeyToStore: string | null | undefined;
  let apiKeyHintToStore: string | null | undefined;
  if (data.apiKey == null) {
    // Explicit key removal — zero both the encrypted key and the hint to avoid stale display
    apiKeyToStore = null;
    apiKeyHintToStore = null;
  } else if (data.apiKey && !MASKED_API_KEY_PATTERN.test(data.apiKey)) {
    // Validate minimum key length to surface accidental empty-like submissions
    if (data.apiKey.trim().length < 8) {
      throw new Error("apiKey too short — minimum 8 characters");
    }
    apiKeyToStore = encrypt(data.apiKey);
    apiKeyHintToStore = data.apiKey.trim().slice(-4);
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
    ...(apiKeyHintToStore !== undefined && { apiKeyHint: apiKeyHintToStore }),
  };

  // Build update payload: include apiKey/hint only when they changed
  const updateData =
    apiKeyToStore !== undefined
      ? { ...baseData, apiKey: apiKeyToStore, apiKeyHint: apiKeyHintToStore }
      : apiKeyHintToStore === null
        ? { ...baseData, apiKeyHint: null }
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
    // Sanitize before logging — provider errors may contain partial API keys
    // (e.g. "Incorrect API key provided: sk-proj-abc...") which would appear in log aggregators
    const safeErr =
      err instanceof Error
        ? err.message
            .replace(/sk-[^\s"]+/g, "sk-[REDACTED]")
            .replace(/[a-zA-Z0-9]{32,}/g, "[REDACTED]")
        : String(err);
    console.error("[testAiConnection] provider error:", safeErr);

    // Map common provider error patterns to safe, generic messages for the frontend.
    // Raw provider messages can expose partial API keys ("sk-proj-xxx...") or internal details.
    const raw = err instanceof Error ? err.message : String(err);
    let message: string;
    if (/401|unauthorized|incorrect api key|invalid.*(key|token)/i.test(raw)) {
      message = "API key inválida ou sem permissão. Verifique a chave configurada.";
    } else if (/429|rate.?limit|quota/i.test(raw)) {
      message = "Limite de requisições atingido no provider. Tente novamente em instantes.";
    } else if (/5\d{2}|server error|internal error|service unavailable/i.test(raw)) {
      message = "Erro interno no servidor do provider. Tente novamente mais tarde.";
    } else if (/timeout|timed out|ETIMEDOUT/i.test(raw)) {
      message = "Timeout ao conectar ao provider. Verifique a conexão.";
    } else {
      message = "Erro ao testar conexão com o provider. Verifique as configurações.";
    }
    return { ok: false, error: message };
  }
}

/**
 * List available models for the company's configured provider.
 */
export async function listAvailableModels(
  companyId: string,
  providerOverride?: string,
): Promise<string[]> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  // Validate providerOverride against VALID_PROVIDERS (mirrors updateAiConfig).
  // An unknown provider would silently return [] via HARDCODED_MODELS[provider] ?? [].
  // Explicit rejection surfaces misconfiguration in the UI immediately.
  if (providerOverride !== undefined && !VALID_PROVIDERS.includes(providerOverride as typeof VALID_PROVIDERS[number])) {
    throw new Error(`provider must be one of: ${VALID_PROVIDERS.join(", ")}`);
  }

  const config = await prisma.aiConfig.findUnique({
    where: { companyId },
  });

  // Use providerOverride (current UI state) if provided, otherwise fall back to
  // the persisted config. This ensures the model list reflects the provider
  // the admin has selected in the form — even before saving.
  const provider = providerOverride ?? config?.provider ?? "openai";

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

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("days must be an integer between 1 and 365");
  }

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
  companyId: string,
  provider: string,
  dailyBudgetBrl: number,
): Promise<ModelSuggestionData> {
  await requireAdmin();
  await requireCompanyAccess(companyId);
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

  // Runtime validation for channel (TypeScript-only types aren't enforced at HTTP boundaries)
  const VALID_CHANNELS = ["WHATSAPP", "EMAIL"] as const;
  if (!VALID_CHANNELS.includes(channel as (typeof VALID_CHANNELS)[number])) {
    return {
      response: "",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostBrl: 0,
      error: "Canal inválido",
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

  // Map internal error codes to safe user-facing messages (avoid leaking
  // implementation details to the browser — mirrors the pattern in testAiConnection)
  let userError: string | undefined;
  if (result.error) {
    const errorMap: Record<string, string> = {
      "api_key_decrypt_failed": "Erro ao acessar a configuração de API key.",
      "email_channel_disabled": "Canal Email está desabilitado nas configurações.",
      "whatsapp_channel_disabled": "Canal WhatsApp está desabilitado nas configurações.",
      "AI not enabled": "A IA está desabilitada. Habilite nas configurações gerais.",
      "daily_spend_limit_reached": "Limite de gasto diário atingido.",
      "max iterations reached": "Limite de iterações atingido sem resposta.",
      "timeout": "Tempo limite de resposta atingido.",
    };
    userError =
      errorMap[result.error] ??
      (result.error.startsWith("no_default_model_for_provider:")
        ? "Nenhum modelo padrão configurado para o provider selecionado."
        : "Erro ao simular resposta. Verifique as configurações da IA.");
  }

  return {
    response: result.response,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    estimatedCostBrl: result.estimatedCostBrl,
    error: userError,
    // Informational: simulation usage is persisted in AiUsageLog (isSimulation=true)
    // for internal/technical auditing, but is NOT visible in the "Consumo de IA" tab
    // (getUsageSummary filters isSimulation: false) and does NOT count against the
    // daily budget limit (getTodaySpend also filters isSimulation: false).
    simulationWarning:
      "Esta simulação é registrada internamente para auditoria técnica, " +
      "mas NÃO aparece na tab 'Consumo de IA' nem consome seu limite de gastos diário.",
  };
}
