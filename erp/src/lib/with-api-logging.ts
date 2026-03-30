import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createChildLogger, classifyError, classifyErrorByStatus } from "@/lib/logger";
import { verifyAccessToken } from "@/lib/auth";
import { traceStore } from "@/lib/trace-context";

/**
 * Route context for Next.js App Router handlers.
 * Uses `params: Promise<Record<string, string | string[]>>` to match
 * Next.js 15 conventions. Handlers may narrow the param types; the wrapper
 * only forwards the context, so widening here is safe.
 */
export type RouteContext = {
  params: Promise<Record<string, string | string[]>>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRouteContext = { params: Promise<any> };

type RouteHandler = (
  req: NextRequest,
  ctx: AnyRouteContext,
) => Promise<NextResponse> | NextResponse;

/** Options for withApiLogging wrapper. */
export interface ApiLoggingOptions {
  /**
   * Sampling rate between 0 and 1. Default: 1.0 (log every request).
   * Set to 0.1 to log only 10% of requests (useful for health endpoints).
   * Errors are ALWAYS logged regardless of sampling.
   */
  sampling?: number;
}

/**
 * Wraps a Next.js App Router API route handler with structured logging.
 *
 * Logs: method, path, status code, duration, userId (from Authorization header via verifyAccessToken), errors.
 * Sets traceId in AsyncLocalStorage so downstream withLogging calls share the same trace.
 * Supports sampling to reduce log volume for high-frequency endpoints.
 *
 * Usage:
 *   async function handler(req: NextRequest, ctx: RouteContext) { ... }
 *   export const POST = withApiLogging('auth.logout', handler);
 *   export const GET = withApiLogging('health', handler, { sampling: 0.1 });
 */
export function withApiLogging(
  routeName: string,
  handler: RouteHandler,
  options?: ApiLoggingOptions,
): RouteHandler {
  const samplingRate = options?.sampling ?? 1.0;

  return async (req: NextRequest, ctx: AnyRouteContext): Promise<NextResponse> => {
    const traceId = randomUUID();

    // Run the entire handler inside traceStore so downstream calls inherit the traceId
    return traceStore.run({ traceId }, async () => {
      const start = Date.now();
      const log = createChildLogger({ route: routeName, traceId });
      const method = req.method;
      const path = req.nextUrl.pathname;
      const shouldLog = Math.random() < samplingRate;

      // Best-effort userId extraction from Authorization header using verifyAccessToken
      let userId: string | undefined;
      const authHeader = req.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const payload = verifyAccessToken(token);
        userId = payload?.userId ?? undefined;
        if (!payload) {
          userId = "anonymous";
        }
      }

      if (shouldLog) {
        log.info({ method, path, userId }, `api.start: ${routeName}`);
      }

      try {
        const response = await handler(req, ctx);
        const durationMs = Date.now() - start;
        const status = response.status;

        if (shouldLog) {
          const logMethod = status >= 400 ? "warn" : "info";
          const errorCode = status >= 400 ? classifyErrorByStatus(status) : undefined;
          log[logMethod](
            { method, path, status, durationMs, userId, ...(errorCode && { errorCode }) },
            `api.end: ${routeName}`,
          );
        }
        return response;
      } catch (err) {
        // Next.js uses throw for redirect() and notFound() — let them propagate
        if (err && typeof err === "object" && "digest" in err) {
          throw err;
        }

        // Errors ALWAYS log regardless of sampling
        const durationMs = Date.now() - start;
        const errorCode = classifyError(err);
        log.error(
          {
            method,
            path,
            durationMs,
            userId,
            errorCode,
            err:
              err instanceof Error
                ? { message: err.message, stack: err.stack, name: err.name }
                : err,
          },
          `api.error: ${routeName}`,
        );
        return NextResponse.json(
          { error: "Internal Server Error" },
          { status: 500 },
        );
      }
    });
  };
}
