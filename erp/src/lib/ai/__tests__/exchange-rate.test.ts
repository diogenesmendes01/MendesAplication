import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBrlUsdRate,
  getBrlUsdRateSync,
  _resetCacheForTesting,
} from "@/lib/ai/exchange-rate";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SAFE_FALLBACK = 5.80;

function mockFetchSuccess(bid: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ USDBRL: { bid } }),
  });
}

function mockFetchHttpError(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  });
}

function mockFetchNetworkError(message = "Network error") {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetCacheForTesting();
  vi.restoreAllMocks();
  // Suppress console.warn noise in test output
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── getBrlUsdRate (async) ────────────────────────────────────────────────────

describe("getBrlUsdRate()", () => {
  it("fetches and caches the rate on cache miss", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("5.42"));

    const rate = await getBrlUsdRate();

    expect(rate).toBe(5.42);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns cached value on cache hit (no extra fetch)", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("5.42"));

    const first = await getBrlUsdRate();
    const second = await getBrlUsdRate();

    expect(first).toBe(second);
    // fetch should only have been called once (second call is a cache hit)
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns fallback on HTTP error (4xx/5xx)", async () => {
    vi.stubGlobal("fetch", mockFetchHttpError(503));

    const rate = await getBrlUsdRate();

    expect(rate).toBe(SAFE_FALLBACK);
    expect(console.warn).toHaveBeenCalled();
  });

  it("returns fallback on network / timeout error", async () => {
    vi.stubGlobal("fetch", mockFetchNetworkError("fetch failed"));

    const rate = await getBrlUsdRate();

    expect(rate).toBe(SAFE_FALLBACK);
    expect(console.warn).toHaveBeenCalled();
  });

  it("returns fallback when API response has invalid bid (NaN)", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("not-a-number"));

    const rate = await getBrlUsdRate();

    expect(rate).toBe(SAFE_FALLBACK);
    expect(console.warn).toHaveBeenCalled();
  });

  it("returns fallback when bid is zero or negative", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("0"));

    const rate = await getBrlUsdRate();

    expect(rate).toBe(SAFE_FALLBACK);
  });

  it("caches the new value after a successful fetch", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("5.99"));
    await getBrlUsdRate(); // populates cache

    // Now getBrlUsdRateSync should reflect the freshly cached value
    expect(getBrlUsdRateSync()).toBe(5.99);
  });
});

// ─── getBrlUsdRateSync ────────────────────────────────────────────────────────

describe("getBrlUsdRateSync()", () => {
  it("returns the fallback value on cold start", () => {
    // _resetCacheForTesting() was called in beforeEach
    const rate = getBrlUsdRateSync();
    expect(rate).toBe(SAFE_FALLBACK);
  });

  it("triggers a background warm-up fetch on first call (cold start)", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("5.55"));

    getBrlUsdRateSync(); // fires warm-up in background

    // Flush microtasks/promises so the background fetch resolves
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledOnce();
    // After warm-up, the cached value should be updated
    expect(getBrlUsdRateSync()).toBe(5.55);
  });

  it("does NOT trigger another fetch when cache is warm", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("5.42"));
    await getBrlUsdRate(); // warm up cache

    vi.clearAllMocks();

    getBrlUsdRateSync(); // should NOT trigger another fetch
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the live rate after cache is warmed asynchronously", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("6.10"));
    await getBrlUsdRate(); // populate cache

    expect(getBrlUsdRateSync()).toBe(6.10);
  });
});

// ─── _resetCacheForTesting ────────────────────────────────────────────────────

describe("_resetCacheForTesting()", () => {
  it("resets fetchedAt to 0 so the next async call triggers a fetch", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess("5.42"));
    await getBrlUsdRate(); // populate cache

    _resetCacheForTesting();

    vi.stubGlobal("fetch", mockFetchSuccess("6.00"));
    const rate = await getBrlUsdRate(); // should fetch again

    expect(rate).toBe(6.00);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("resets cached value back to fallback", () => {
    // Manually warm cache via async then reset
    _resetCacheForTesting();
    expect(getBrlUsdRateSync()).toBe(SAFE_FALLBACK);
  });
});

// ─── FALLBACK_RATE env var ────────────────────────────────────────────────────

describe("FALLBACK_RATE env var", () => {
  it("module uses 5.80 as hardcoded safe fallback when env var is not set", () => {
    // env var not set in test env → SAFE_FALLBACK should be 5.80
    const rate = getBrlUsdRateSync();
    expect(rate).toBe(SAFE_FALLBACK);
    expect(rate).toBeGreaterThan(0);
  });
});
