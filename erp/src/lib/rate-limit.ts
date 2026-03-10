import Redis from "ioredis";

// ---------------------------------------------------------------------------
// Rate limiter baseado em Redis — compartilha estado entre réplicas.
// Usa sliding window com TTL automático no Redis.
// Fallback in-memory quando Redis está indisponível.
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;
let redisAvailable = true;

// ---------------------------------------------------------------------------
// Fallback in-memory (Map simples com expiração)
// ---------------------------------------------------------------------------
const inMemoryStore = new Map<string, { count: number; expiresAt: number }>();

function inMemoryIncrement(
  key: string,
  windowMs: number
): { count: number; remainingMs: number } {
  const now = Date.now();
  const entry = inMemoryStore.get(key);

  if (!entry || entry.expiresAt <= now) {
    inMemoryStore.set(key, { count: 1, expiresAt: now + windowMs });
    return { count: 1, remainingMs: windowMs };
  }

  entry.count++;
  return { count: entry.count, remainingMs: entry.expiresAt - now };
}

// Limpa entradas expiradas periodicamente (a cada 60s)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(inMemoryStore.entries())) {
    if (entry.expiresAt <= now) {
      inMemoryStore.delete(key);
    }
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Redis connection
// ---------------------------------------------------------------------------
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.on("error", (err) => {
      console.error("[rate-limit] Redis connection error:", err.message);
      redisAvailable = false;
    });
    redis.on("connect", () => {
      redisAvailable = true;
    });
    redis.connect().catch((err) => {
      console.error("[rate-limit] Redis initial connection failed:", err.message);
      redisAvailable = false;
    });
  }
  return redis;
}

const KEY_PREFIX = "rate_limit:login:";

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Check and increment rate limit for a given IP.
 * Uses Redis when available, falls back to in-memory store.
 * @param ip - Client IP address
 * @param maxAttempts - Maximum attempts allowed (default: 10)
 * @param windowMs - Window duration in ms (default: 15 minutes)
 */
export async function checkRateLimit(
  ip: string,
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000
): Promise<RateLimitResult> {
  const key = `${KEY_PREFIX}${ip}`;

  // Try Redis first
  if (redisAvailable) {
    try {
      const client = getRedis();
      const windowSec = Math.ceil(windowMs / 1000);

      const [[, count], [, ttl]] = (await client
        .multi()
        .incr(key)
        .ttl(key)
        .exec()) as [[null, number], [null, number]];

      // Set TTL on first attempt (when ttl is -1, key has no expiry)
      if (ttl === -1) {
        await client.expire(key, windowSec);
      }

      if (count > maxAttempts) {
        const remainingTtl = ttl === -1 ? windowSec : ttl;
        return { allowed: false, retryAfterMs: remainingTtl * 1000 };
      }

      return { allowed: true, retryAfterMs: 0 };
    } catch (err) {
      console.error(
        "[rate-limit] Redis operation failed, falling back to in-memory:",
        err instanceof Error ? err.message : err
      );
      redisAvailable = false;
    }
  }

  // Fallback: in-memory rate limiting
  const { count, remainingMs } = inMemoryIncrement(key, windowMs);

  if (count > maxAttempts) {
    return { allowed: false, retryAfterMs: remainingMs };
  }

  return { allowed: true, retryAfterMs: 0 };
}
