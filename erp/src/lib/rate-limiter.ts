// ─── Rate Limiter Interface + In-Memory & Redis Implementations ─────────────
// See: https://github.com/diogenesmendes01/MendesAplication/issues/124
// See: https://github.com/diogenesmendes01/MendesAplication/issues/310
//
// Redis-backed implementation uses INCR + EXPIRE (fixed window, TTL = windowMs).
// Falls back to InMemoryRateLimiter when Redis is unavailable.

import Redis from "ioredis";

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

/**
 * Async rate limiter interface — used by Redis-backed implementation.
 * Callers that support Redis should use this interface.
 */
export interface AsyncRateLimiter {
  check(key: string): Promise<RateLimiterResult>;
  reset(key: string): Promise<void>;
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

// ─── Redis Implementation ─────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;
let redisAvailable = true;

function getRedisClient(): Redis | null {
  if (!redisAvailable) return null;

  if (!redis) {
    try {
      redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      redis.on("error", (err) => {
        console.error("[rate-limiter] Redis error:", err.message);
        redisAvailable = false;
      });
      redis.on("connect", () => {
        redisAvailable = true;
      });
      redis.connect().catch((err) => {
        console.error("[rate-limiter] Redis connect failed:", err.message);
        redisAvailable = false;
      });
    } catch {
      redisAvailable = false;
      return null;
    }
  }

  return redisAvailable ? redis : null;
}

export class RedisRateLimiter implements AsyncRateLimiter {
  private readonly fallback: InMemoryRateLimiter;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly prefix: string;

  constructor(opts: { limit: number; windowMs: number; prefix: string }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.prefix = opts.prefix;
    this.fallback = new InMemoryRateLimiter({
      limit: opts.limit,
      windowMs: opts.windowMs,
    });
  }

  async check(key: string): Promise<RateLimiterResult> {
    const client = getRedisClient();
    if (!client) {
      return this.fallback.check(key);
    }

    const redisKey = `${this.prefix}:${key}`;
    const windowSec = Math.ceil(this.windowMs / 1000);

    try {
      const results = await client.multi().incr(redisKey).ttl(redisKey).exec();

      if (!results || results.length < 2) {
        throw new Error("Redis multi/exec returned unexpected result");
      }

      const [incrErr, incrVal] = results[0];
      const [ttlErr, ttlVal] = results[1];

      if (incrErr || ttlErr) {
        throw new Error("Redis multi/exec contained errors");
      }

      const count = typeof incrVal === "number" ? incrVal : Number(incrVal);
      const ttl = typeof ttlVal === "number" ? ttlVal : Number(ttlVal);

      // Set TTL on first increment (ttl === -1 means no expiry set yet)
      if (ttl === -1) {
        await client.expire(redisKey, windowSec);
      }

      if (count > this.limit) {
        const remainingSec = ttl === -1 ? windowSec : Math.max(ttl, 1);
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: remainingSec * 1000,
        };
      }

      return {
        allowed: true,
        remaining: this.limit - count,
        retryAfterMs: 0,
      };
    } catch (err) {
      console.error(
        "[rate-limiter] Redis op failed, falling back to in-memory:",
        err instanceof Error ? err.message : err,
      );
      redisAvailable = false;
      return this.fallback.check(key);
    }
  }

  async reset(key: string): Promise<void> {
    const client = getRedisClient();
    if (client) {
      try {
        await client.del(`${this.prefix}:${key}`);
      } catch {
        // ignore — fallback cleanup below
      }
    }
    this.fallback.reset(key);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a synchronous in-memory rate limiter.
 * For Redis-backed rate limiting, use `createAsyncRateLimiter()`.
 */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  return new InMemoryRateLimiter(opts);
}

/**
 * Creates a Redis-backed rate limiter with automatic in-memory fallback.
 * Uses INCR + EXPIRE with a fixed window (TTL = windowMs).
 *
 * @param opts.prefix - Redis key prefix (e.g. "rate:simulate")
 */
export function createAsyncRateLimiter(opts: {
  limit: number;
  windowMs: number;
  prefix: string;
}): AsyncRateLimiter {
  return new RedisRateLimiter(opts);
}
