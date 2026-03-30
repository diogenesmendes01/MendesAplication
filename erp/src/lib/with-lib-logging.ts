import { randomUUID } from "crypto";
import { createChildLogger, sanitizeParams, truncateForLog, classifyError } from "@/lib/logger";
import { traceStore } from "@/lib/trace-context";

/**
 * Wraps a library/worker function with automatic structured logging.
 *
 * Unlike `withLogging`, this does **NOT** call `getSession()` / `cookies()`
 * and is safe for use outside of Server Actions (e.g. BullMQ workers,
 * utility functions, background jobs).
 *
 * Logs: action name, duration, result (success/error).
 * On error: logs full error with stack trace, errorCode, and re-throws.
 * Uses traceId from AsyncLocalStorage if available, otherwise generates a new one.
 *
 * Usage:
 *   async function _processJob(data: JobData) { ... }
 *   export const processJob = withLibLogging('worker.processJob', _processJob);
 */
export function withLibLogging<TArgs extends unknown[], TReturn>(
  actionName: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const start = Date.now();

    // Use propagated traceId if available, otherwise generate a new one for standalone invocations
    const store = traceStore.getStore();
    const traceId = store?.traceId ?? randomUUID();
    const log = createChildLogger({
      action: actionName,
      traceId,
    });

    const sanitizedArgs = args.map((a) =>
      a && typeof a === "object" ? sanitizeParams(a as Record<string, unknown>) : a,
    );
    const truncatedArgs = sanitizedArgs.map(truncateForLog);

    log.info({ args: truncatedArgs }, `action.start: ${actionName}`);

    try {
      const result = await fn(...args);
      const durationMs = Date.now() - start;
      log.info(
        { durationMs, status: "success" },
        `action.end: ${actionName}`,
      );
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorCode = classifyError(err);
      log.error(
        {
          durationMs,
          status: "error",
          errorCode,
          err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
        },
        `action.error: ${actionName}`,
      );
      throw err;
    }
  };
}
