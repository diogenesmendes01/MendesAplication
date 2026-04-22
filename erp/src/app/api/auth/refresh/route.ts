import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  verifyRefreshToken,
  generateAccessToken,
  generateRefreshToken,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withApiLogging } from "@/lib/with-api-logging";

async function _POST() {
  // Read refresh token from httpOnly cookie
  const cookieStore = cookies();
  const refreshToken = cookieStore.get("refreshToken")?.value;

  if (!refreshToken) {
    return NextResponse.json(
      { error: "Refresh token não encontrado" },
      { status: 401 }
    );
  }

  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    return NextResponse.json(
      { error: "Refresh token inválido ou expirado" },
      { status: 401 }
    );
  }

  // Ensure user still exists and is active
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Usuário não encontrado ou inativo" },
      { status: 401 }
    );
  }

  const tokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const newAccessToken = generateAccessToken(tokenPayload);
  const newRefreshToken = generateRefreshToken(tokenPayload);

  const response = NextResponse.json({ accessToken: newAccessToken });

  // Access token cookie — httpOnly:true protege contra XSS
  response.cookies.set("accessToken", newAccessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60, // 30 minutes (session inactivity timeout)
  });

  // Set new refresh token as httpOnly cookie
  response.cookies.set("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });

  return response;
}

export const POST = withApiLogging("auth.refresh", _POST);
