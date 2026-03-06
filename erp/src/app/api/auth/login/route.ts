import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
} from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Rate limiting simples em memória — protege contra brute force no login.
// Limite: MAX_ATTEMPTS tentativas por IP em WINDOW_MS milissegundos.
// Nota: em deploy multi-instância considere Redis ou um middleware externo
// (ex: Cloudflare Rate Limiting) para compartilhar estado entre réplicas.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();

// Limpar entradas expiradas periodicamente para evitar memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now - entry.windowStart > WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }
}, WINDOW_MS);

function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Nova janela
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export async function POST(req: NextRequest) {
  try {
    // Extrair IP do cliente para rate limiting
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const { allowed, retryAfterMs } = checkRateLimit(clientIp);
    if (!allowed) {
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      return NextResponse.json(
        {
          error: `Muitas tentativas de login. Aguarde ${Math.ceil(retryAfterSec / 60)} minuto(s) antes de tentar novamente.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(MAX_ATTEMPTS),
            "X-RateLimit-Window": "900",
          },
        }
      );
    }

    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "E-mail e senha são obrigatórios" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Credenciais inválidas" },
        { status: 401 }
      );
    }

    if (user.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Usuário inativo. Contate o administrador." },
        { status: 403 }
      );
    }

    const passwordValid = await comparePassword(password, user.passwordHash);
    if (!passwordValid) {
      return NextResponse.json(
        { error: "Credenciais inválidas" },
        { status: 401 }
      );
    }

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;

    // Fire and forget — don't block login response
    logAuditEvent({
      userId: user.id,
      action: "LOGIN",
      entity: "User",
      entityId: user.id,
      ipAddress,
    }).catch(console.error);

    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    // Access token cookie — not httpOnly so middleware can read it
    response.cookies.set("accessToken", accessToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 60, // 30 minutes (session inactivity timeout)
    });

    // Refresh token cookie — httpOnly for security
    response.cookies.set("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
