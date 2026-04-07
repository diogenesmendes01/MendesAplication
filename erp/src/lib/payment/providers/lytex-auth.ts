// ============================================================
// LytexAuth — Token management com cache + refresh token
// ============================================================
// A Lytex usa autenticação por accessToken + refreshToken.
// Token expira em **5 minutos** — muito mais curto que outros providers.
// Cache em memória com Map keyed por clientId:clientSecret pra suportar
// múltiplas empresas simultâneas.
// ============================================================

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedAuth {
  accessToken: string;
  refreshToken: string;
  /** Timestamp (ms) em que o access token expira (com margem de segurança) */
  expiresAt: number;
  /** Timestamp (ms) em que o refresh token expira (com margem de segurança) */
  refreshExpiresAt: number;
}

interface LytexAuthResponse {
  accessToken: string;
  refreshToken: string;
  expireAt: string;
  refreshExpireAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BASE_URL = "https://api-pay.lytex.com.br";
export const SANDBOX_BASE_URL = "https://sandbox-api-pay.lytex.com.br";

/** Margem de segurança: renova token 60s antes de expirar (de 5min TTL) */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Timeout para todas as requisições HTTP */
export const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Token Cache (module-level, survives across calls within same process)
// ---------------------------------------------------------------------------

const authCache = new Map<string, CachedAuth>();

/**
 * Pending promise cache to implement singleflight pattern.
 * With Lytex's 5-minute token TTL, concurrent refresh calls are more likely.
 * Only one auth operation per cache key is allowed at a time.
 */
const pendingAuthRequests = new Map<string, Promise<string>>();

/**
 * Limpa o cache de tokens. Útil para testes.
 */
export function clearTokenCache(): void {
  authCache.clear();
}

/**
 * Remove um token específico do cache.
 */
export function invalidateToken(clientId: string, clientSecret: string): void {
  authCache.delete(`${clientId}:${clientSecret}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getBaseUrl(sandbox: boolean): string {
  return sandbox ? SANDBOX_BASE_URL : BASE_URL;
}

/**
 * Obtém um novo par de tokens via POST /v2/auth/obtain_token.
 */
async function obtainNewToken(
  clientId: string,
  clientSecret: string,
  cacheKey: string,
  baseUrl: string,
): Promise<string> {
  logger.info("[Lytex] Requesting new auth token");

  const response = await fetch(`${baseUrl}/v2/auth/obtain_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Lytex auth failed (HTTP ${response.status}): ${errorText || response.statusText}`,
    );
  }

  const data = (await response.json()) as LytexAuthResponse;

  if (!data.accessToken) {
    throw new Error("Lytex auth error: resposta sem accessToken");
  }

  authCache.set(cacheKey, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: new Date(data.expireAt).getTime() - TOKEN_REFRESH_MARGIN_MS,
    refreshExpiresAt:
      new Date(data.refreshExpireAt).getTime() - TOKEN_REFRESH_MARGIN_MS,
  });

  return data.accessToken;
}

/**
 * Renova o token via POST /v2/auth/refresh_token.
 * Se falhar, limpa o cache pra forçar novo obtain.
 */
async function refreshAuth(
  cached: CachedAuth,
  cacheKey: string,
  baseUrl: string,
): Promise<string> {
  logger.info("[Lytex] Refreshing auth token");

  const response = await fetch(`${baseUrl}/v2/auth/refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accessToken: cached.accessToken,
      refreshToken: cached.refreshToken,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Refresh falhou → limpar cache, forçar novo obtain
    authCache.delete(cacheKey);
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Lytex refresh failed (HTTP ${response.status}): ${errorText || response.statusText}`,
    );
  }

  const data = (await response.json()) as LytexAuthResponse;

  authCache.set(cacheKey, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: new Date(data.expireAt).getTime() - TOKEN_REFRESH_MARGIN_MS,
    refreshExpiresAt:
      new Date(data.refreshExpireAt).getTime() - TOKEN_REFRESH_MARGIN_MS,
  });

  return data.accessToken;
}

// ---------------------------------------------------------------------------
// getAuthToken
// ---------------------------------------------------------------------------

/**
 * Obtém um accessToken válido para a Lytex.
 * Usa cache em memória com refresh automático.
 * Implementa singleflight para evitar race condition em refresh/obtain.
 *
 * Fluxo:
 * 1. Token no cache e válido → retorna
 * 2. Access expirou mas refresh válido → refresh (com singleflight)
 * 3. Tudo expirou → obtain novo par (com singleflight)
 */
export async function getAuthToken(
  clientId: string,
  clientSecret: string,
  sandbox: boolean = false,
): Promise<string> {
  const cacheKey = `${clientId}:${clientSecret}`;
  const cached = authCache.get(cacheKey);
  const baseUrl = getBaseUrl(sandbox);

  // Token válido → retorna
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  // F1.2: Singleflight pattern — if auth is already in flight, wait for it
  const pending = pendingAuthRequests.get(cacheKey);
  if (pending) {
    return pending;
  }

  // Create a new auth promise and store it so other concurrent requests wait
  const authPromise = (async () => {
    try {
      const refreshedCached = authCache.get(cacheKey);

      // Access expirou mas refresh válido → refresh
      if (
        refreshedCached &&
        refreshedCached.refreshExpiresAt > Date.now()
      ) {
        return refreshAuth(refreshedCached, cacheKey, baseUrl);
      }

      // Nada válido → obtain fresh
      return obtainNewToken(clientId, clientSecret, cacheKey, baseUrl);
    } finally {
      // Always clean up the pending promise
      pendingAuthRequests.delete(cacheKey);
    }
  })();

  pendingAuthRequests.set(cacheKey, authPromise);
  return authPromise;
}

// ---------------------------------------------------------------------------
// authenticatedFetch
// ---------------------------------------------------------------------------

/**
 * Wrapper de fetch que injeta automaticamente o token
 * e faz auto-retry em caso de 401/410 (token expirado entre cache e request).
 */
export async function authenticatedFetch(
  clientId: string,
  clientSecret: string,
  path: string,
  options: RequestInit = {},
  sandbox: boolean = false,
): Promise<Response> {
  const baseUrl = getBaseUrl(sandbox);
  let accessToken = await getAuthToken(clientId, clientSecret, sandbox);

  const makeRequest = (token: string): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        // Lytex usa token raw no Authorization header (sem prefix "Bearer")
        // Ref: docs-pay.lytex.com.br/documentacao/v2 — seção "Criando a cobrança"
        Authorization: token,
        ...(options.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let response = await makeRequest(accessToken);

  // Token expirou entre cache e request — invalidar e retry uma vez
  if (response.status === 401 || response.status === 410) {
    logger.info("[Lytex] Token expired mid-request, refreshing");
    invalidateToken(clientId, clientSecret);
    accessToken = await getAuthToken(clientId, clientSecret, sandbox);
    response = await makeRequest(accessToken);
  }

  return response;
}
