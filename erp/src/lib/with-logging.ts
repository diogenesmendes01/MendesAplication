import { createChildLogger, sanitizeParams, truncateForLog, classifyError } from "@/lib/logger";
import { getSession } from "@/lib/session";

/**
 * Wraps a server action with automatic structured logging.
 *
 * Logs: action name, userId, companyId, duration, result (success/error).
 * On error: logs full error with stack trace, errorCode, and re-throws.
 * Generates a traceId per invocation.
 * Sanitizes and truncates parameters before logging (strips sensitive fields, caps large args).
 *
 * Usage:
 *   async function _myAction(companyId: string, data: MyInput) { ... }
 *   export const myAction = withLogging('module.myAction', _myAction);
 */
export function withLogging<TArgs extends unknown[], TReturn>(
  actionName: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const start = Date.now();
    const log = createChildLogger({ action: actionName });

    // Best-effort session extraction (non-blocking)
    let userId: string | undefined;
    let companyId: string | undefined;
    try {
      const session = await getSession();
      userId = session?.userId;
    } catch {
      // Session not available (e.g. unauthenticated action) — continue
    }

    // Extract companyId only from an object arg that explicitly has the property
    if (args.length > 0) {
      const first = args[0];
      if (first && typeof first === "object" && "companyId" in (first as Record<string, unknown>)) {
        companyId = (first as Record<string, unknown>).companyId as string;
      }
    }

    const sanitizedArgs = args.map((a) =>
      a && typeof a === "object" ? sanitizeParams(a as Record<string, unknown>) : a,
    );

    // Truncate large args to avoid log bloat
    const truncatedArgs = sanitizedArgs.map(truncateForLog);

    log.info(
      { userId, companyId, args: truncatedArgs },
      `action.start: ${actionName}`,
    );

    try {
      const result = await fn(...args);
      const durationMs = Date.now() - start;
      log.info(
        { userId, companyId, durationMs, status: "success" },
        `action.end: ${actionName}`,
      );
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorCode = classifyError(err);
      log.error(
        {
          userId,
          companyId,
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
