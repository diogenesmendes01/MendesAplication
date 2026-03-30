import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { withApiLogging } from "@/lib/with-api-logging";

async function _POST(req: NextRequest) {
  try {
    const token = req.cookies.get("accessToken")?.value;

    if (token) {
      const payload = verifyAccessToken(token);
      if (payload) {
        const ipAddress =
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          req.headers.get("x-real-ip") ??
          null;

        await logAuditEvent({
          userId: payload.userId,
          action: "LOGOUT",
          entity: "User",
          entityId: payload.userId,
          ipAddress,
        });
      }
    }

    const response = NextResponse.json({ success: true });

    // Clear both cookies
    response.cookies.set("accessToken", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    response.cookies.set("refreshToken", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging("auth.logout", _POST);
