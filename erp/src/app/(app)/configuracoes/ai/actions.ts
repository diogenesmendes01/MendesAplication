"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { encrypt, decrypt } from "@/lib/encryption";
import { chatCompletion } from "@/lib/ai/provider";
import { getTodaySpend, getUsageSummary, type UsageSummary } from "@/lib/ai/cost-tracker";
import { suggestModel } from "@/lib/ai/model-suggester";
import { discoverModels } from "@/lib/ai/model-discovery";
import { runAgentDryRun, type DryRunResult } from "@/lib/ai/agent";
import type { Prisma, ChannelType } from "@prisma/client";
import { createAsyncRateLimiter } from "@/lib/rate-limiter";
import { logger } from "@/lib/logger";
import { resolveAiConfig } from "@/lib/ai/resolve-config";

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
  apiKey: string | null; // masked on read, plain on write, null to clear
  model: string;
  // Channels
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  emailPersona: string | null;
  emailSignature: string | null;
  // Limits
  dailySpendLimitBrl: number | null;
  // Reclame Aqui
  raEnabled: boolean;
  raMode: string; // "suggest" | "auto" | "off"
  raPrivateBeforePublic: boolean;
  raAutoRequestEvaluation: boolean;
  raEscalationKeywords: string[];
  // Temperature
  temperature: number;
  // Suggestion Mode
  operationMode: "auto" | "suggest" | "hybrid";
  hybridThreshold: number; // 0.0-1.0
  alwaysRequireApproval: string[];
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
// Channel type for frontend consumption (matches Prisma ChannelType enum)
// ---------------------------------------------------------------------------

export type AiConfigChannel = ChannelType | null;

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

function configToData(config: {
  enabled: boolean;
  persona: string;
  welcomeMessage: string | null;
  escalationKeywords: string[];
  maxIterations: number;
  provider: string;
  apiKey: string | null;
  apiKeyHint: string | null;
  model: string | null;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  emailPersona: string | null;
  emailSignature: string | null;
  dailySpendLimitBrl: Prisma.Decimal | number | null;
  raEnabled: boolean;
  raMode: string;
  raPrivateBeforePublic: boolean;
  raAutoRequestEvaluation: boolean;
  raEscalationKeywords: string[];
  temperature: number;
  operationMode: "auto" | "suggest" | "hybrid";
  hybridThreshold: number;
  alwaysRequireApproval: string[];
}): AiConfigData {
  return {
    enabled: config.enabled,
    persona: config.persona,
    welcomeMessage: config.welcomeMessage ?? "",
    escalationKeywords: config.escalationKeywords,
    maxIterations: config.maxIterations,
    provider: config.provider,
    apiKey: maskApiKey(config.apiKey, config.apiKeyHint),
    model: config.model ?? "",
    whatsappEnabled: config.whatsappEnabled,
    emailEnabled: config.emailEnabled,
    emailPersona: config.emailPersona ?? "",
    emailSignature: config.emailSignature ?? "",
    dailySpendLimitBrl: config.dailySpendLimitBrl
      ? Number(config.dailySpendLimitBrl)
      : null,
    raEnabled: config.raEnabled,
    raMode: config.raMode,
    raPrivateBeforePublic: config.raPrivateBeforePublic,
    raAutoRequestEvaluation: config.raAutoRequestEvaluation,
    raEscalationKeywords: config.raEscalationKeywords,
    temperature: config.temperature,
    operationMode: config.operationMode,
    hybridThreshold: config.hybridThreshold,
    alwaysRequireApproval: config.alwaysRequireApproval,
  };
}

const DEFAULT_AI_CONFIG: AiConfigData = {
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
  raEnabled: false,
  raMode: "suggest",
  raPrivateBeforePublic: true,
  raAutoRequestEvaluation: false,
  raEscalationKeywords: ["processo", "advogado", "procon", "judicial", "indenização"],
  operationMode: "auto",
  hybridThreshold: 0.8,
  alwaysRequireApproval: [],
};

// ---------------------------------------------------------------------------
// Rate limiters — Redis-backed with in-memory fallback.
// Keys: rate:simulate:{companyId}, rate:testconn:{companyId} (TTL 60s)
// See: https://github.com/diogenesmendes01/MendesAplication/issues/310
// ---------------------------------------------------------------------------

const testConnectionLimiter = createAsyncRateLimiter({
  limit: 5,
  windowMs: 60_000,
  prefix: "rate:testconn",
});

async function checkTestConnectionRateLimit(companyId: string): Promise<boolean> {
  const result = await testConnectionLimiter.check(companyId);
  return result.allowed;
}

const simulationLimiter = createAsyncRateLimiter({
  limit: 10,
  windowMs: 60_000,
  prefix: "rate:simulate",
});

async function checkSimulationRateLimit(companyId: string): Promise<boolean> {
  const result = await simulationLimiter.check(companyId);
  return result.allowed;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Get AI config for a company, optionally for a specific channel.
 * When channel is provided: looks for channel-specific config first,
 * falls back to global config (channel=null).
 * When channel is null/undefined: returns the global config.
 */
export async function getAiConfig(
  companyId: string,
  channel?: ChannelType | null,
): Promise<AiConfigData> {
  await requireCompanyAccess(companyId);

  const config = await resolveAiConfig(companyId, channel);

  if (!config) {
    return { ...DEFAULT_AI_CONFIG };
  }

  return configToData({ ...config, operationMode: config.operationMode as "auto" | "suggest" | "hybrid" });
}

const VALID_PROVIDERS = ["openai", "anthropic", "grok", "qwen", "deepseek"] as const;

/**
 * Pattern that identifies a masked API key returned by maskApiKey().
 * Masked keys always start with four asterisks (e.g. "****ab12").
 * Using a regex constant makes the intent explicit and avoids fragile
 * string comparisons scattered across the codebase.
 */
const MASKED_API_KEY_PATTERN = /^\*{4}/;

/**
 * Update (upsert) AI config for a company, optionally for a specific channel.
 * When channel is provided: upserts the channel-specific config row.
 * When channel is null/undefined: upserts the global config row.
 */
export async function updateAiConfig(
  companyId: string,
  data: AiConfigData,
  channel?: ChannelType | null,
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
  // - If the incoming apiKey is null, clear the key (admin wants to remove it)
  // - If the incoming apiKey is empty or matches the masked pattern, keep existing
  // - Otherwise, validate and encrypt the new value
  let apiKeyToStore: string | null | undefined;
  let apiKeyHintToStore: string | null | undefined;
  if (data.apiKey === null) {
    // Explicitly clear the API key
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

  const resolvedChannel = channel ?? null;

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
    operationMode: data.operationMode,
    hybridThreshold: data.hybridThreshold,
    alwaysRequireApproval: data.alwaysRequireApproval,
    raEnabled: data.raEnabled,
    raMode: data.raMode,
    raPrivateBeforePublic: data.raPrivateBeforePublic,
    raAutoRequestEvaluation: data.raAutoRequestEvaluation,
    raEscalationKeywords: data.raEscalationKeywords,
  };

  const createData = {
    companyId,
    channel: resolvedChannel,
    ...baseData,
    apiKey: apiKeyToStore ?? null,
    ...(apiKeyHintToStore !== undefined && { apiKeyHint: apiKeyHintToStore }),
  };

  const updateData = apiKeyToStore !== undefined
    ? { ...baseData, apiKey: apiKeyToStore, apiKeyHint: apiKeyHintToStore }
    : baseData;

  // Wrap in transaction to prevent TOCTOU race condition
  await prisma.$transaction(async (tx) => {
    const existing = await tx.aiConfig.findFirst({
      where: { companyId, channel: resolvedChannel },
      select: { id: true },
    });

    if (existing) {
      await tx.aiConfig.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      await tx.aiConfig.create({
        data: createData,
      });
    }
  });

  // Audit log — redact apiKey from the logged data
  const auditData = {
    ...data,
    channel: resolvedChannel,
    apiKey: data.apiKey === null ? "(cleared)" : data.apiKey ? "(redacted)" : "(empty)",
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
 * Uses the global config (channel=null) for connection testing.
 */
export async function testAiConnection(
  companyId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  if (!(await checkTestConnectionRateLimit(companyId))) {
    return { ok: false, error: "Limite de testes atingido (máx 5/min). Aguarde um momento." };
  }

  const config = await resolveAiConfig(companyId);

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
    logger.error({ err: safeErr }, "[testAiConnection] provider error:");

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
 * Uses the global config (channel=null) for model discovery.
 */
export async function listAvailableModels(
  companyId: string,
  providerOverride?: string,
): Promise<string[]> {
  await requireAdmin();
  await requireCompanyAccess(companyId);

  if (providerOverride !== undefined && !VALID_PROVIDERS.includes(providerOverride as typeof VALID_PROVIDERS[number])) {
    throw new Error(`provider must be one of: ${VALID_PROVIDERS.join(", ")}`);
  }

  const config = await resolveAiConfig(companyId);

  const provider = providerOverride ?? config?.provider ?? "openai";

  // Decrypt API key if available (needed for dynamic discovery)
  let apiKey: string | undefined;
  if (config?.apiKey) {
    try {
      apiKey = decrypt(config.apiKey);
    } catch {
      // Fall through — discoverModels will use static fallback
    }
  }

  // Dynamic discovery with cache + static fallback (all providers)
  return discoverModels(provider, { apiKey });
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
  if (!(await checkSimulationRateLimit(companyId))) {
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

