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
