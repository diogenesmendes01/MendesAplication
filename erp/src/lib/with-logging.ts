import { createChildLogger, sanitizeParams, truncateForLog, classifyError } from "@/lib/logger";
import { getSession } from "@/lib/session";
import { traceStore } from "@/lib/trace-context";

/**
 * Extract companyId from args with deep search (1 level).
 * Checks all args (not just first) for a `companyId` property.
 * @internal
 */
function extractCompanyId(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (arg && typeof arg === "object" && !Array.isArray(arg)) {
      const obj = arg as Record<string, unknown>;
      if (typeof obj.companyId === "string") {
        return obj.companyId;
      }
      // Deep search: 1 level into nested objects
      for (const value of Object.values(obj)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const nested = value as Record<string, unknown>;
          if (typeof nested.companyId === "string") {
            return nested.companyId;
          }
        }
      }
    }
    // Also accept companyId as a plain string arg (first match by convention)
    if (typeof arg === "string" && args.indexOf(arg) === 0) {
      // Don't blindly pick strings — only objects above
    }
  }
  return undefined;
}

/**
 * Wraps a server action with automatic structured logging.
 *
 * **Server Actions only** — calls `getSession()` which depends on `cookies()`.
 * For lib/worker functions, use `withLibLogging` from `@/lib/with-lib-logging`.
 *
 * Logs: action name, userId, companyId, duration, result (success/error).
 * On error: logs full error with stack trace, errorCode, and re-throws.
 * Uses traceId from AsyncLocalStorage (set by withApiLogging) or generates a new one.
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

    // Use propagated traceId from API layer if available, otherwise createChildLogger generates one
    const store = traceStore.getStore();
    const log = createChildLogger({
      action: actionName,
      ...(store?.traceId ? { traceId: store.traceId } : {}),
    });

    // Best-effort session extraction (non-blocking)
    let userId: string | undefined;
    try {
      const session = await getSession();
      userId = session?.userId;
    } catch {
      // Session not available (e.g. unauthenticated action) — continue
    }

    // Deep search for companyId across all args (1 level deep)
    const companyId = extractCompanyId(args);

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
