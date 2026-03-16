// ─── Rate Limiter Interface + In-Memory Implementation ───────────────────────
// See: https://github.com/diogenesmendes01/MendesAplication/issues/124
//
// ## Current limitation
// The in-memory implementation is per-process: in a multi-instance deployment
// (e.g. multiple serverless workers or containers), each process has its own
// Map, so the effective limit is `limit * N_INSTANCES`.
//
// ## Redis migration path
// 1. Create `RedisRateLimiter` implementing `RateLimiter` interface below
// 2. Use Redis MULTI/EXEC with sorted sets:
//    - ZADD key <now> <now>        (add timestamp)
//    - ZREMRANGEBYSCORE key 0 <now - windowMs>  (prune old)
//    - ZCARD key                   (count recent)
//    - EXPIRE key <windowMs/1000>  (auto-cleanup)
// 3. Swap `createRateLimiter()` to return Redis-backed instance
// 4. Keep InMemoryRateLimiter as fallback when Redis is unavailable

// ─── Interface ────────────────────────────────────────────────────────────────

export interface RateLimiterResult {
  allowed: boolean;
  /** Remaining calls in the current window. */
  remaining: number;
  /** Milliseconds until the window resets (0 if allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  /**
   * Check if the action is allowed for the given key (e.g. companyId).
   * If allowed, the call is counted. If not, returns retry info.
   */
  check(key: string): RateLimiterResult;

  /**
   * Reset rate limit for a specific key. Useful for testing.
   */
  reset(key: string): void;
}

// ─── In-Memory Implementation ─────────────────────────────────────────────────

export class InMemoryRateLimiter implements RateLimiter {
  private readonly map = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(opts: { limit: number; windowMs: number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
  }

  check(key: string): RateLimiterResult {
    const now = Date.now();
    const timestamps = this.map.get(key) ?? [];
    const recent = timestamps.filter((ts) => now - ts < this.windowMs);

    // Cleanup: remove key entirely if no recent timestamps
    if (recent.length === 0 && this.map.has(key)) {
      this.map.delete(key);
    }

    if (recent.length >= this.limit) {
      this.map.set(key, recent);
      const oldestInWindow = recent[0];
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    recent.push(now);
    this.map.set(key, recent);

    return {
      allowed: true,
      remaining: this.limit - recent.length,
      retryAfterMs: 0,
    };
  }

  reset(key: string): void {
    this.map.delete(key);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a rate limiter instance.
 *
 * Currently returns InMemoryRateLimiter.
 * When Redis is available, swap this to return a Redis-backed implementation.
 */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  // TODO(#124): When Redis is available:
  // if (redisClient) return new RedisRateLimiter(redisClient, opts);
  return new InMemoryRateLimiter(opts);
}
