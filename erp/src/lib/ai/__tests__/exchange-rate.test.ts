import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBrlUsdRate,
  getBrlUsdRateSync,
  _resetCacheForTesting,
} from "../exchange-rate";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function okResponse(bid: number | string) {
  return new Response(JSON.stringify({ USDBRL: { bid: String(bid) } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function missingFieldResponse() {
  return new Response(JSON.stringify({ USDBRL: {} }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const FALLBACK = 5.8;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("exchange-rate", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.useFakeTimers({ now: Date.now() });
    _resetCacheForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it("fetches rate from API and returns the bid value", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(5.42));

    const rate = await getBrlUsdRate();

    expect(rate).toBe(5.42);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://economia.awesomeapi.com.br/json/last/USD-BRL",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  // ── Cache TTL (24 h) ───────────────────────────────────────────────────

  it("returns cached value within 24 h without a second fetch", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(5.42));
    await getBrlUsdRate();
    fetchSpy.mockClear();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 60_000);
    const rate = await getBrlUsdRate();

    expect(rate).toBe(5.42);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-fetches after cache expires (>= 24 h)", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(5.42));
    await getBrlUsdRate();
    fetchSpy.mockClear();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    fetchSpy.mockResolvedValueOnce(okResponse(5.55));

    const rate = await getBrlUsdRate();
    expect(rate).toBe(5.55);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  // ── Invalid API responses ──────────────────────────────────────────────

  it("falls back when bid is <= 0", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(0));
    const rate = await getBrlUsdRate();
    expect(rate).toBe(FALLBACK);
  });

  it("falls back when bid is negative", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(-1));
    const rate = await getBrlUsdRate();
    expect(rate).toBe(FALLBACK);
  });

  it("falls back when USDBRL.bid field is missing", async () => {
    fetchSpy.mockResolvedValueOnce(missingFieldResponse());
    const rate = await getBrlUsdRate();
    expect(rate).toBe(FALLBACK);
  });

  it("falls back when API returns non-200 status", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Service Unavailable", { status: 503 }),
    );
    const rate = await getBrlUsdRate();
    expect(rate).toBe(FALLBACK);
  });

  // ── Timeout (5 s) ─────────────────────────────────────────────────────

  it("falls back when fetch exceeds 5 s timeout", async () => {
    fetchSpy.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const promise = getBrlUsdRate();
    vi.advanceTimersByTime(5_001);

    const rate = await promise;
    expect(rate).toBe(FALLBACK);
  });

  // ── Network failure ───────────────────────────────────────────────────

  it("falls back when fetch throws a network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network error"));
    const rate = await getBrlUsdRate();
    expect(rate).toBe(FALLBACK);
  });

  // ── _resetCacheForTesting + re-fetch ──────────────────────────────────

  it("_resetCacheForTesting clears cache and forces re-fetch", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(5.42));
    await getBrlUsdRate();
    fetchSpy.mockClear();

    _resetCacheForTesting();
    fetchSpy.mockResolvedValueOnce(okResponse(5.99));

    const rate = await getBrlUsdRate();
    expect(rate).toBe(5.99);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("_resetCacheForTesting resets sync rate to fallback", () => {
    _resetCacheForTesting();
    expect(getBrlUsdRateSync()).toBe(FALLBACK);
  });

  // ── getBrlUsdRateSync ─────────────────────────────────────────────────

  it("getBrlUsdRateSync returns cached rate after successful fetch", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(5.42));
    await getBrlUsdRate();
    expect(getBrlUsdRateSync()).toBe(5.42);
  });

  // ── Fallback to env var BRL_USD_RATE ──────────────────────────────────

  it("uses fallback rate (env or 5.80) when API fails on first call", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("DNS failure"));
    const rate = await getBrlUsdRate();
    expect(rate).toBe(FALLBACK);
  });

  it("after API failure, retains last known good rate in cache", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(5.42));
    await getBrlUsdRate();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

    fetchSpy.mockRejectedValueOnce(new Error("API down"));
    const rate = await getBrlUsdRate();
    expect(rate).toBe(5.42);
  });
});
