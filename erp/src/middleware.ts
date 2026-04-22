import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/webhooks",
];

const SESSION_MAX_AGE = 30 * 60; // 30 minutes in seconds

const jwtSecretValue = process.env.JWT_SECRET;
if (!jwtSecretValue) {
  throw new Error(
    "JWT_SECRET não configurada. Configure a variável de ambiente antes de iniciar a aplicação."
  );
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretValue);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths, static files, and Next.js internals
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const accessToken = req.cookies.get("accessToken")?.value;

  // No cookie → redirect to login
  if (!accessToken) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Validate JWT — if expired or invalid, clear cookie and redirect to login
  let payload: { exp?: number };
  try {
    const result = await jwtVerify(accessToken, JWT_SECRET);
    payload = result.payload as { exp?: number };
  } catch {
    const loginUrl = new URL("/login", req.url);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete("accessToken");
    response.cookies.delete("refreshToken");
    return response;
  }

  // Sliding session: only refresh the cookie if token expires within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const exp = payload.exp;
  const REFRESH_WINDOW = 5 * 60; // 5 minutes

  if (exp && exp - now < REFRESH_WINDOW) {
    const response = NextResponse.next();
    response.cookies.set("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files and _next internals.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
