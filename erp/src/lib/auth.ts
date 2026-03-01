import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const REFRESH_SECRET =
  process.env.REFRESH_SECRET || "dev-refresh-secret-change-in-production";

const ACCESS_TOKEN_EXPIRY = "30m";
const REFRESH_TOKEN_EXPIRY = "7d";

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Hash a plain-text password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Compare a plain-text password with a bcrypt hash.
 */
export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a short-lived JWT access token (15 min).
 */
export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * Generate a long-lived JWT refresh token (7 days).
 */
export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

/**
 * Verify and decode an access token. Returns the payload or null if invalid.
 */
export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Verify and decode a refresh token. Returns the payload or null if invalid.
 */
export function verifyRefreshToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Get the full user record from a valid access token string.
 * Returns null if the token is invalid or the user doesn't exist.
 */
export async function getCurrentUser(token: string) {
  const payload = verifyAccessToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  });

  if (!user || user.status !== "ACTIVE") return null;
  return user;
}
