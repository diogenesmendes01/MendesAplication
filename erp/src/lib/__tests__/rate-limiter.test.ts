/**
 * Unit tests for the RateLimiter interface and InMemoryRateLimiter.
 * See: https://github.com/diogenesmendes01/MendesAplication/issues/124
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { InMemoryRateLimiter, createRateLimiter } from "@/lib/rate-limiter";

describe("InMemoryRateLimiter", () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new InMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within the limit", () => {
    const r1 = limiter.check("company-1");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.check("company-1");
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.check("company-1");
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests exceeding the limit", () => {
    limiter.check("company-1");
    limiter.check("company-1");
    limiter.check("company-1");

    const r4 = limiter.check("company-1");
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks different keys independently", () => {
    limiter.check("company-1");
    limiter.check("company-1");
    limiter.check("company-1");

    // company-1 is at limit, but company-2 should be fine
    const r = limiter.check("company-2");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("allows requests again after the window expires", () => {
    limiter.check("company-1");
    limiter.check("company-1");
    limiter.check("company-1");

    // Should be blocked
    expect(limiter.check("company-1").allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(60_001);

    // Should be allowed again
    const r = limiter.check("company-1");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("reset() clears the limit for a key", () => {
    limiter.check("company-1");
    limiter.check("company-1");
    limiter.check("company-1");
    expect(limiter.check("company-1").allowed).toBe(false);

    limiter.reset("company-1");

    const r = limiter.check("company-1");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("retryAfterMs is reasonable when blocked", () => {
    limiter.check("company-1");
    limiter.check("company-1");
    limiter.check("company-1");

    const r = limiter.check("company-1");
    expect(r.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("createRateLimiter", () => {
  it("returns a working RateLimiter instance", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(limiter.check("test").allowed).toBe(true);
    expect(limiter.check("test").allowed).toBe(true);
    expect(limiter.check("test").allowed).toBe(false);
  });
});
