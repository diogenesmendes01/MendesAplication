import { logger } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveryOptions {
  apiKey?: string;
  cacheTtlMs?: number;
}

interface CacheEntry {
  models: string[];
  fetchedAt: number;
}

// ─── Static fallback lists ────────────────────────────────────────────────────
// Used when dynamic discovery is unavailable (no API key, network error, etc.)

export const STATIC_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: [
    "claude-opus-4-5",
    "claude-opus-4-20250514",
    "claude-sonnet-4-5",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
  ],
  grok: ["grok-2", "grok-2-mini"],
  qwen: ["qwen-max", "qwen-plus", "qwen-turbo"],
  deepseek: ["deepseek-reasoner", "deepseek-chat"],
};

// ─── Provider API endpoints ───────────────────────────────────────────────────

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1/models",
  deepseek: "https://api.deepseek.com/models",
  grok: "https://api.x.ai/v1/models",
};

// ─── Model ID filters per provider ───────────────────────────────────────────
// Only return chat-capable models, not embeddings, TTS, image, etc.

const MODEL_FILTERS: Record<string, (id: string) => boolean> = {
  openai: (id) =>
    id.startsWith("gpt-") &&
    !id.includes("instruct") &&
    !id.includes("realtime") &&
    !id.includes("audio") &&
    !id.includes("search"),
  deepseek: (id) =>
    id.startsWith("deepseek-") &&
    !id.includes("embed"),
  grok: (id) =>
    id.startsWith("grok-") &&
    !id.includes("embed"),
};

// ─── In-memory cache ──────────────────────────────────────────────────────────

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, CacheEntry>();

/**
 * Clear the model discovery cache. Useful for testing or forced refresh.
 */
export function clearModelCache(): void {
  cache.clear();
}

/**
 * Clear cache for a specific provider.
 */
export function clearProviderCache(provider: string): void {
  cache.delete(provider);
}

// ─── Discovery logic ──────────────────────────────────────────────────────────

/**
 * Fetch models from a provider's /models API endpoint.
 * Returns null on any failure (network, auth, parse error).
 */
async function fetchModelsFromApi(
  provider: string,
  apiKey: string,
): Promise<string[] | null> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn(
        `[model-discovery] ${provider} API returned ${res.status}`,
      );
      return null;
    }

    const data = await res.json();
    const allModels: string[] = (data.data ?? []).map(
      (m: { id: string }) => m.id,
    );

    const filter = MODEL_FILTERS[provider];
    const filtered = filter ? allModels.filter(filter) : allModels;

    return filtered.length > 0 ? filtered.sort() : null;
  } catch (err) {
    logger.warn(
      `[model-discovery] Failed to fetch models from ${provider}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Discover available models for a provider.
 *
 * Strategy:
 * 1. Return from cache if fresh
 * 2. If provider has a list endpoint AND apiKey is provided, fetch dynamically
 * 3. Cache the result on success
 * 4. Fall back to STATIC_MODELS on failure or when no endpoint/key available
 *
 * This function is safe to call without an API key — it will simply return
 * the static fallback list.
 */
export async function discoverModels(
  provider: string,
  options: DiscoveryOptions = {},
): Promise<string[]> {
  const { apiKey, cacheTtlMs = DEFAULT_CACHE_TTL_MS } = options;

  // 1. Check cache
  const cached = cache.get(provider);
  if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.models;
  }

  // 2. Try dynamic discovery if possible
  if (apiKey && PROVIDER_ENDPOINTS[provider]) {
    const models = await fetchModelsFromApi(provider, apiKey);
    if (models) {
      cache.set(provider, { models, fetchedAt: Date.now() });
      return models;
    }
  }

  // 3. Fallback to static list
  return STATIC_MODELS[provider] ?? [];
}

/**
 * Synchronous version that only returns cached or static models.
 * Used by suggestModel() which must remain a pure sync function.
 */
export function getModelsSync(provider: string): string[] {
  const cached = cache.get(provider);
  if (cached && Date.now() - cached.fetchedAt < DEFAULT_CACHE_TTL_MS) {
    return cached.models;
  }
  return STATIC_MODELS[provider] ?? [];
}
