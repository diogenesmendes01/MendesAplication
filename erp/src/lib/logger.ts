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
