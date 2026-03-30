// ─── Structured Logger ───────────────────────────────────────────────────────
// Centralized pino logger for the ERP application.
// See: https://github.com/diogenesmendes01/MendesAplication/issues/126
//
// Usage:
//   import { logger, createChildLogger } from "@/lib/logger";
//   logger.info({ companyId, ticketId }, "Processing ticket");
//
//   // Per-request child logger with traceId (Issue #306):
//   const log = createChildLogger({ companyId, ticketId });
//   log.info("Processing ticket");  // auto-includes traceId, companyId, ticketId

import pino from "pino";
import { randomUUID } from "crypto";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty" },
  }),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Standard context fields attached to log entries. */
export interface LogContext {
  traceId?: string;
  action?: string;
  route?: string;
  userId?: string;
  companyId?: string;
  durationMs?: number;
  status?: "success" | "error";
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

/** Structured error codes for log classification and filtering. */
export const ErrorCode = {
  AUTH_FAILED: "AUTH_FAILED",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  ENCRYPTION_ERROR: "ENCRYPTION_ERROR",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Classify an error into a structured ErrorCode based on its properties.
 * Used by withLogging and withApiLogging for consistent error categorization.
 */
export function classifyError(err: unknown): ErrorCodeValue {
  if (err && typeof err === "object") {
    // HTTP-style status codes
    const status = (err as Record<string, unknown>).status ?? (err as Record<string, unknown>).statusCode;
    if (status === 401 || status === 403) return ErrorCode.AUTH_FAILED;
    if (status === 404) return ErrorCode.NOT_FOUND;
    if (status === 429) return ErrorCode.RATE_LIMIT_EXCEEDED;

    const name = (err as Record<string, unknown>).name as string | undefined;
    const message = (err as Record<string, unknown>).message as string | undefined;
    const code = (err as Record<string, unknown>).code as string | undefined;

    // Prisma errors
    if (name?.startsWith("Prisma") || code?.startsWith("P")) return ErrorCode.DATABASE_ERROR;

    // Encryption errors
    if (message?.toLowerCase().includes("decrypt") || message?.toLowerCase().includes("encrypt")) {
      return ErrorCode.ENCRYPTION_ERROR;
    }

    // Validation
    if (name === "ZodError" || name === "ValidationError" || message?.toLowerCase().includes("validation")) {
      return ErrorCode.VALIDATION_ERROR;
    }

    // Auth keywords
    if (message?.toLowerCase().includes("unauthorized") || message?.toLowerCase().includes("forbidden")) {
      return ErrorCode.AUTH_FAILED;
    }
    if (message?.toLowerCase().includes("token expired") || message?.toLowerCase().includes("jwt expired")) {
      return ErrorCode.AUTH_TOKEN_EXPIRED;
    }

    // External service
    if (message?.toLowerCase().includes("econnrefused") || message?.toLowerCase().includes("econnreset") || message?.toLowerCase().includes("etimedout")) {
      return ErrorCode.EXTERNAL_SERVICE_ERROR;
    }
  }

  return ErrorCode.INTERNAL_ERROR;
}

/**
 * Classify an error by HTTP status code (for API routes).
 */
export function classifyErrorByStatus(status: number): ErrorCodeValue {
  switch (status) {
    case 401:
    case 403:
      return ErrorCode.AUTH_FAILED;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 429:
      return ErrorCode.RATE_LIMIT_EXCEEDED;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "key",
  "apikey",
  "senha",
  "cookie",
  "authorization",
  "accesstoken",
  "refreshtoken",
  // LGPD-sensitive fields
  "cpf",
  "cnpj",
  "certificatepassword",
  "cert",
  "pfx",
]);

/**
 * Deep-clone an object/array, replacing values of sensitive keys with "[REDACTED]".
 * Handles nested objects and arrays recursively.
 * Safe for logging user-supplied params without leaking credentials.
 */
export function sanitizeParams(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      result[k] = "[REDACTED]";
    } else if (Array.isArray(v)) {
      result[k] = sanitizeArray(v);
    } else if (v && typeof v === "object") {
      result[k] = sanitizeParams(v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Sanitize each element in an array recursively.
 */
function sanitizeArray(arr: unknown[]): unknown[] {
  return arr.map((item) => {
    if (Array.isArray(item)) {
      return sanitizeArray(item);
    }
    if (item && typeof item === "object") {
      return sanitizeParams(item as Record<string, unknown>);
    }
    return item;
  });
}

// ---------------------------------------------------------------------------
// Truncation for large log arguments
// ---------------------------------------------------------------------------

/** Maximum size in bytes for a single log argument before truncation. */
export const MAX_LOG_ARG_SIZE = 10_240; // 10KB

/** Maximum array length before truncation. */
const MAX_LOG_ARRAY_LENGTH = 100;

/**
 * Truncate large values before logging to prevent log bloat.
 *
 * - Strings > MAX_LOG_ARG_SIZE chars → truncated with suffix
 * - Arrays > 100 items → first 100 items + indicator
 * - Objects whose JSON > MAX_LOG_ARG_SIZE → truncated JSON string
 * - Primitives → returned as-is
 */
export function truncateForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (value.length > MAX_LOG_ARG_SIZE) {
      return value.slice(0, MAX_LOG_ARG_SIZE) + `...[truncated, original ${value.length} chars]`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_LOG_ARRAY_LENGTH) {
      const truncated = value.slice(0, MAX_LOG_ARRAY_LENGTH).map(truncateForLog);
      truncated.push(`...[${value.length} items, showing first ${MAX_LOG_ARRAY_LENGTH}]`);
      return truncated;
    }
    return value.map(truncateForLog);
  }

  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      if (json.length > MAX_LOG_ARG_SIZE) {
        return json.slice(0, MAX_LOG_ARG_SIZE) + `...[truncated, original ${json.length} chars]`;
      }
    } catch {
      // Circular reference or similar — return as-is
    }
    return value;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Child logger factory
// ---------------------------------------------------------------------------

/**
 * Creates a child logger with automatic traceId (correlationId) injection.
 * Each call generates a unique traceId via randomUUID().
 * All log lines from the child carry traceId + any extra bindings (companyId, ticketId, etc).
 */
export function createChildLogger(bindings: {
  companyId?: string;
  ticketId?: string;
  traceId?: string;
  [key: string]: unknown;
} = {}) {
  return logger.child({
    traceId: bindings.traceId || randomUUID(),
    ...bindings,
  });
}
