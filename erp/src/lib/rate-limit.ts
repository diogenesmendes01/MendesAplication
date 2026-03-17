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

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Safely extract a numeric value from a Redis multi/exec result entry.
 * Returns null if the entry is malformed or contains an error.
 */
function parseExecResult(
  entry: [error: Error | null, result: unknown] | undefined
): number | null {
  if (!entry) return null;
  const [err, value] = entry;
  if (err) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Check and increment rate limit for a given IP.
 * Uses Redis when available, falls back to in-memory store.
 * @param ip - Client IP address
 * @param maxAttempts - Maximum attempts allowed (default: 10)
 * @param windowMs - Window duration in ms (default: 15 minutes)
 * @param prefix - Key prefix for namespacing (default: "login")
 */
export async function checkRateLimit(
  ip: string,
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000,
  prefix = "login"
): Promise<RateLimitResult> {
  const key = `rate_limit:${prefix}:${ip}`;

  // Try Redis first
  if (redisAvailable) {
    try {
      const client = getRedis();
      const windowSec = Math.ceil(windowMs / 1000);

      // Atomic INCR + conditional EXPIRE via Lua script.
      // Using a separate `expire()` call after `incr()` is non-atomic: if the
      // process crashes or the connection drops between the two calls, the key
      // is left without a TTL and the rate-limit counter never resets —
      // permanently blocking the company/IP for that prefix.
      // The Lua script runs atomically on the Redis server, guaranteeing that
      // the TTL is always set on the first increment.
      const luaScript = `
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return {count, redis.call('TTL', KEYS[1])}
      `;

      const result = await client.eval(luaScript, 1, key, String(windowSec)) as [number, number];

      if (!Array.isArray(result) || result.length < 2) {
        throw new Error("Lua eval returned unexpected result");
      }

      const [count, ttl] = result;

      if (count > maxAttempts) {
        return { allowed: false, retryAfterMs: ttl > 0 ? ttl * 1000 : windowMs };
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
