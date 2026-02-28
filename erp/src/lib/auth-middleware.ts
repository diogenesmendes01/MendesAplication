import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, type JwtPayload } from "@/lib/auth";

/**
 * Extract the Bearer token from the Authorization header.
 */
function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

/**
 * Wraps an API route handler, ensuring a valid JWT is present.
 * On success the handler receives the decoded JWT payload.
 * On failure a 401 JSON response is returned automatically.
 */
export function withAuth(
  handler: (
    req: NextRequest,
    context: { params: Record<string, string> },
    user: JwtPayload
  ) => Promise<NextResponse> | NextResponse
) {
  return async (
    req: NextRequest,
    context: { params: Record<string, string> }
  ) => {
    const token = extractBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { error: "Token de autenticação não fornecido" },
        { status: 401 }
      );
    }

    const payload = verifyAccessToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Token inválido ou expirado" },
        { status: 401 }
      );
    }

    return handler(req, context, payload);
  };
}
