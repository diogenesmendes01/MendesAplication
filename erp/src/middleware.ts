import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/refresh",
];

const SESSION_MAX_AGE = 30 * 60; // 30 minutes in seconds

export function middleware(req: NextRequest) {
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

  // Unauthenticated → redirect to /login
  if (!accessToken) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Sliding session: refresh the cookie maxAge on every authenticated request
  const response = NextResponse.next();
  response.cookies.set("accessToken", accessToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files and _next internals.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
