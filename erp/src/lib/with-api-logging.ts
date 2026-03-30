import { NextRequest, NextResponse } from "next/server";
import { createChildLogger } from "@/lib/logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteContext = any;

type RouteHandler = (
  req: NextRequest,
  ctx: RouteContext,
) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a Next.js App Router API route handler with structured logging.
 *
 * Logs: method, path, status code, duration, userId (from Authorization header), errors.
 *
 * Usage:
 *   async function handler(req: NextRequest, ctx: RouteContext) { ... }
 *   export const POST = withApiLogging('auth/logout', handler);
 */
export function withApiLogging(
  routeName: string,
  handler: RouteHandler,
): RouteHandler {
  return async (req: NextRequest, ctx: RouteContext): Promise<NextResponse> => {
    const start = Date.now();
    const log = createChildLogger({ route: routeName });
    const method = req.method;
    const path = req.nextUrl.pathname;

    // Best-effort userId extraction from Authorization header
    let userId: string | undefined;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const payload = JSON.parse(
          Buffer.from(authHeader.slice(7).split(".")[1], "base64").toString(),
        );
        userId = payload.userId;
      } catch {
        // Token not parseable — continue without userId
      }
    }

    log.info({ method, path, userId }, `api.start: ${routeName}`);

    try {
      const response = await handler(req, ctx);
      const durationMs = Date.now() - start;
      const status = response.status;
      const logMethod = status >= 400 ? "warn" : "info";
      log[logMethod](
        { method, path, status, durationMs, userId },
        `api.end: ${routeName}`,
      );
      return response;
    } catch (err) {
      // Next.js uses throw for redirect() and notFound() — let them propagate
      if (err && typeof err === 'object' && 'digest' in err) {
        throw err;
      }

      const durationMs = Date.now() - start;
      log.error(
        {
          method,
          path,
          durationMs,
          userId,
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
  };
}
