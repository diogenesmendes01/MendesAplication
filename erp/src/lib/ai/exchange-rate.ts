// ─── Dynamic BRL/USD Exchange Rate ───────────────────────────────────────────
// Fetches the current USD→BRL rate from AwesomeAPI with 24h in-memory cache.
// Falls back to BRL_USD_RATE env var (or 5.80 hardcoded) if the API is unavailable.
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

/**
 * Returns the current BRL/USD exchange rate.
 *
 * - Fetches from AwesomeAPI (free, no auth required)
 * - Caches the result for 24 hours
 * - Falls back to env var BRL_USD_RATE or 5.80 if API fails
 *
 * TODO: Replace console.warn with structured logger after #126
 */
export async function getBrlUsdRate(): Promise<number> {
  if (Date.now() - cachedRate.fetchedAt < TTL_MS) {
    return cachedRate.value;
  }

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
      `[exchange-rate] API failed, using fallback ${SAFE_FALLBACK}:`,
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
}
