// ─── Structured Logger ───────────────────────────────────────────────────────
// Centralized pino logger for the ERP application.
// See: https://github.com/diogenesmendes01/MendesAplication/issues/126
//
// Usage:
//   import { logger } from "@/lib/logger";
//   logger.info({ companyId, ticketId }, "Processing ticket");
//   logger.warn({ model, fallback: true }, "Using fallback pricing");
//   logger.error({ error }, "Failed to process");

import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty" },
  }),
});
