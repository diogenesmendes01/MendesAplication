/**
 * AI Fallback Chain
 */

import { prisma } from "@/lib/prisma";
import { chatCompletion } from "./provider";
import type {
  AiMessage,
  AiResponse,
  AnyAiToolDefinition,
  ProviderConfig,
} from "./provider";
import { getPreviousStatus } from "./health-checker";
import { logger } from "@/lib/logger";

export interface FallbackProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
}

export interface FallbackResult extends AiResponse {
  usedProvider: string;
  usedModel: string;
  usedFallback: boolean;
  chainIndex: number;
}

export function isProviderError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("503") ||
      msg.includes("502") ||
      msg.includes("429") ||
      msg.includes("500") ||
      msg.includes("rate limit") ||
      msg.includes("overloaded") ||
      msg.includes("connection") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("enotfound") ||
      msg.includes("fetch failed")
    );
  }
  return false;
}

export async function chatCompletionWithFallback(
  messages: AiMessage[],
  tools: AnyAiToolDefinition[] | undefined,
  chain: FallbackProviderConfig[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<FallbackResult> {
  if (chain.length === 0) {
    throw new Error("Fallback chain is empty \u2014 no providers configured");
  }

  const errors: { provider: string; model: string; error: string }[] = [];

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const isLast = i === chain.length - 1;

    if (!isLast) {
      const health = await getPreviousStatus(entry.provider, entry.model);
      if (health === "down") {
        logger.info(
          { provider: entry.provider, model: entry.model },
          "[fallback] Skipping down provider",
        );
        errors.push({ provider: entry.provider, model: entry.model, error: "skipped (known down)" });
        continue;
      }
    }

    try {
      const config: ProviderConfig = {
        provider: entry.provider,
        apiKey: entry.apiKey,
        model: entry.model,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      };

      const response = await chatCompletion(messages, tools, config);

      if (i > 0) {
        logger.info(
          { primary: chain[0].model, usedFallback: entry.model, chainIndex: i },
          "[fallback] Used fallback provider",
        );
      }

      return {
        ...response,
        usedProvider: entry.provider,
        usedModel: entry.model,
        usedFallback: i > 0,
        chainIndex: i,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { provider: entry.provider, model: entry.model, error: errMsg, fallbacksRemaining: chain.length - i - 1 },
        "[fallback] Provider failed, trying next",
      );
      errors.push({ provider: entry.provider, model: entry.model, error: errMsg });
      if (isLast) {
        throw new Error(
          `All providers in fallback chain failed: ${errors.map((e) => `${e.provider}/${e.model}: ${e.error}`).join("; ")}`,
        );
      }
    }
  }

  throw new Error("All providers in fallback chain failed");
}

export async function buildFallbackChain(
  companyId: string,
  channel?: string | null,
): Promise<FallbackProviderConfig[]> {
  const { decrypt } = await import("@/lib/encryption");

  const configs = await prisma.aiConfig.findMany({
    where: { companyId, enabled: true, apiKey: { not: null } },
    select: { channel: true, provider: true, model: true, apiKey: true, fallbackChain: true },
    orderBy: { channel: "asc" },
  });

  if (configs.length === 0) return [];

  const config =
    configs.find((c) => c.channel === channel) ||
    configs.find((c) => c.channel === null) ||
    configs[0];

  const primaryApiKey = decrypt(config.apiKey!);

  if (config.fallbackChain && Array.isArray(config.fallbackChain)) {
    const chain = config.fallbackChain as Array<{ provider: string; model: string; apiKey?: string }>;
    return chain.map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      apiKey: entry.apiKey ? decrypt(entry.apiKey) : primaryApiKey,
    }));
  }

  return [{
    provider: config.provider,
    model: config.model || "gpt-4o-mini",
    apiKey: primaryApiKey,
  }];
}
