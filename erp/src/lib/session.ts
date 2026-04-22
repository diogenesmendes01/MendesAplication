"use server";

import { cookies } from "next/headers";
import { verifyAccessToken, type JwtPayload } from "@/lib/auth";

/**
 * Get the authenticated user's JWT payload from the access token cookie.
 * For use in server actions and server components.
 * Returns null if not authenticated.
 */
export async function getSession(): Promise<JwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("accessToken")?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

/**
 * Get the authenticated user or throw an error.
 * Use in server actions that require authentication.
 */
export async function requireSession(): Promise<JwtPayload> {
  const session = await getSession();
  if (!session) {
    throw new Error("Não autenticado");
  }
  return session;
}

/**
 * Require the user to have ADMIN role. Throws if not admin.
 */
export async function requireAdmin(): Promise<JwtPayload> {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("Acesso negado. Apenas administradores podem realizar esta ação.");
  }
  return session;
}
