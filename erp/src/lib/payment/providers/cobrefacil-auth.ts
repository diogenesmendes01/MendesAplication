// ============================================================
// CobreFacilAuth — Token management com cache + auto-refresh
// ============================================================
// O Cobre Fácil usa autenticação por token Bearer que expira (~3600s).
// Cache em memória com Map keyed por appId:secret pra suportar
// múltiplas empresas simultâneas.
// ============================================================

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  /** Timestamp (ms) em que o token expira (com margem de segurança) */
  expiresAt: number;
}

interface AuthResponse {
  success: boolean;
  message?: string;
  data?: {
    token: string;
    expiration: number; // seconds until expiration
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE_URL = "https://api.cobrefacil.com.br/v1";

/** Margem de segurança: renova token 5 min antes de expirar */
export const TOKEN_REFRESH_MARGIN_MS = 300_000;

/** Timeout para todas as requisições HTTP */
export const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Token Cache (module-level, survives across calls within same process)
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, CachedToken>();

/**
 * Limpa o cache de tokens. Útil para testes.
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * Remove um token específico do cache.
 */
export function invalidateToken(appId: string, secret: string): void {
  tokenCache.delete(`${appId}:${secret}`);
}

// ---------------------------------------------------------------------------
// getAuthToken
// ---------------------------------------------------------------------------

/**
 * Obtém um token Bearer válido para o Cobre Fácil.
 * Usa cache em memória e renova automaticamente quando necessário.
 *
 * @param appId - App ID da aplicação no Cobre Fácil
 * @param secret - Secret da aplicação no Cobre Fácil
 * @returns Token Bearer válido
 * @throws Error se a autenticação falhar
 */
export async function getAuthToken(
  appId: string,
  secret: string,
): Promise<string> {
  const cacheKey = `${appId}:${secret}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  logger.info("[CobreFacil] Requesting new auth token");

  const response = await fetch(`${BASE_URL}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, secret }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Cobre Fácil auth failed (HTTP ${response.status}): ${errorText || response.statusText}`,
    );
  }

  const json = (await response.json()) as AuthResponse;

  if (!json.success || !json.data?.token) {
    throw new Error(
      `Cobre Fácil auth error: ${json.message ?? "Resposta inesperada do servidor"}`,
    );
  }

  const { token, expiration } = json.data;

  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiration * 1000 - TOKEN_REFRESH_MARGIN_MS,
  });

  return token;
}

// ---------------------------------------------------------------------------
// authenticatedFetch
// ---------------------------------------------------------------------------

/**
 * Wrapper de fetch que injeta automaticamente o token Bearer
 * e faz auto-retry em caso de 401 (token expirado entre cache e request).
 *
 * @param appId - App ID da aplicação
 * @param secret - Secret da aplicação
 * @param path - Caminho relativo à base URL (ex: "/customers")
 * @param options - Opções adicionais do fetch (method, body, etc.)
 * @returns A Response do fetch
 */
export async function authenticatedFetch(
  appId: string,
  secret: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  let token = await getAuthToken(appId, secret);

  const makeRequest = (bearerToken: string): Promise<Response> =>
    fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
        ...(options.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let response = await makeRequest(token);

  // Token expirou entre cache e request — invalidar e retry uma vez
  if (response.status === 401) {
    logger.info("[CobreFacil] Token expired mid-request, refreshing");
    invalidateToken(appId, secret);
    token = await getAuthToken(appId, secret);
    response = await makeRequest(token);
  }

  return response;
}
