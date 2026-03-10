import Redis from "ioredis";

// ---------------------------------------------------------------------------
// Rate limiter baseado em Redis — compartilha estado entre réplicas.
// Usa sliding window com TTL automático no Redis.
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.connect().catch(() => {
      // Silently handle — will retry on next call
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
 * @param ip - Client IP address
 * @param maxAttempts - Maximum attempts allowed (default: 10)
 * @param windowMs - Window duration in ms (default: 15 minutes)
 */
export async function checkRateLimit(
  ip: string,
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000
): Promise<RateLimitResult> {
  const client = getRedis();
  const key = `${KEY_PREFIX}${ip}`;
  const windowSec = Math.ceil(windowMs / 1000);

  try {
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
  } catch {
    // If Redis is unavailable, allow the request (fail open)
    // to avoid blocking all logins when Redis is down.
    console.warn("[rate-limit] Redis unavailable, allowing request");
    return { allowed: true, retryAfterMs: 0 };
  }
}
