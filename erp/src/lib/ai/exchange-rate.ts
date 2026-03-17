// ─── Dynamic BRL/USD Exchange Rate ───────────────────────────────────────────
// Fetches the current USD→BRL rate from AwesomeAPI with 24h in-memory cache.
// Falls back to BRL_USD_RATE env var (or 5.80 hardcoded) if the API is unavailable.
//
// ⚠️  Serverless / Edge note:
//   This module uses a module-level variable as cache. In long-lived runtimes
//   (Node.js containers, VMs) the 24h TTL works as expected. In serverless
//   environments (Vercel Functions, AWS Lambda) each cold start re-creates the
//   module, so the cache is zeroed on every cold invocation and the 24h TTL
//   becomes effectively a "per-instance" TTL — the AwesomeAPI may be called on
//   every cold-start request. This is acceptable for the current traffic levels,
//   but consider a shared cache (Redis / Vercel KV) if cold-start frequency
//   becomes a concern.
//
// See: https://github.com/diogenesmendes01/MendesAplication/issues/125

const FALLBACK_RATE = parseFloat(process.env.BRL_USD_RATE ?? "5.80");
const SAFE_FALLBACK =
  Number.isFinite(FALLBACK_RATE) && FALLBACK_RATE > 0 ? FALLBACK_RATE : 5.80;

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedRate {
  value: number;
  fetchedAt: number;
}

let cachedRate: CachedRate = { value: SAFE_FALLBACK, fetchedAt: 0 };

// Inflight deduplication — prevents N concurrent cache-miss callers from each
// firing a separate HTTP request to AwesomeAPI when the cache expires.
let inflight: Promise<number> | null = null;

/**
 * Returns the current BRL/USD exchange rate.
 *
 * - Fetches from AwesomeAPI (free, no auth required)
 * - Caches the result for 24 hours in-memory
 * - Deduplicates concurrent cache-miss requests (single inflight promise)
 * - Falls back to env var BRL_USD_RATE or 5.80 if API fails
 *
 * TODO: Replace console.warn with structured logger after #126
 */
export async function getBrlUsdRate(): Promise<number> {
  if (Date.now() - cachedRate.fetchedAt < TTL_MS) {
    return cachedRate.value;
  }

  // Deduplicate: reuse any in-progress fetch instead of firing another one
  if (inflight) return inflight;

  inflight = _fetchRate().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** @internal Separated for deduplication and testability */
async function _fetchRate(): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      "https://economia.awesomeapi.com.br/json/last/USD-BRL",
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`AwesomeAPI returned ${res.status}`);
    }

    const data = await res.json();
    const bid = parseFloat(data?.USDBRL?.bid);

    if (!Number.isFinite(bid) || bid <= 0) {
      throw new Error(`Invalid rate from API: ${data?.USDBRL?.bid}`);
    }

    cachedRate = { value: bid, fetchedAt: Date.now() };
    return bid;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[exchange-rate] API failed, using fallback ${cachedRate.value}:`,
      error instanceof Error ? error.message : String(error)
    );
    return cachedRate.value; // Use last known rate or env fallback
  }
}

/**
 * Synchronous fallback — returns the cached rate or env var default.
 * Use this only where async is not possible.
 *
 * On first call (cold start), triggers a fire-and-forget async warm-up so that
 * subsequent calls (and the next sync call after TTL) will return the live rate.
 * Until the warm-up resolves, the env-var / hardcoded fallback is returned.
 */
export function getBrlUsdRateSync(): number {
  if (cachedRate.fetchedAt === 0) {
    // Fire-and-forget: warm the cache in the background without blocking.
    getBrlUsdRate().catch(() => {
      // Errors are already logged inside getBrlUsdRate(); suppress here.
    });
  }
  return cachedRate.value;
}

/**
 * Reset cache — for testing purposes only.
 * @internal
 */
export function _resetCacheForTesting(): void {
  cachedRate = { value: SAFE_FALLBACK, fetchedAt: 0 };
  inflight = null;
}
