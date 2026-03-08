"use server";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { hashPassword } from "@/lib/auth";

/**
 * Request a password reset. Always returns success to avoid email enumeration.
 */
export async function requestPasswordReset(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, name: true, email: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    return { success: true };
  }

  // Invalidate any existing unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Generate token with 1 hour expiry
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: { token, userId: user.id, expiresAt },
  });

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  await sendEmail({
    to: user.email,
    subject: "Redefinição de senha - MendesERP",
    htmlBody: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Redefinição de Senha</h2>
        <p>Olá <strong>${user.name}</strong>,</p>
        <p>Recebemos uma solicitação para redefinir sua senha no MendesERP.</p>
        <p>
          <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background: #0f172a; color: #fff; text-decoration: none; border-radius: 6px;">
            Redefinir Senha
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          Ou copie e cole este link no navegador:<br/>
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
        <p style="color: #666; font-size: 14px;">
          Este link expira em <strong>1 hora</strong>. Se você não solicitou a
          redefinição, ignore este e-mail.
        </p>
      </div>
    `.trim(),
  });

  return { success: true };
}

/**
 * Validate that a password reset token is still valid.
 */
export async function validateResetToken(token: string) {
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    select: { expiresAt: true, usedAt: true },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { valid: false };
  }

  return { valid: true };
}

/**
 * Reset the user's password using a valid reset token.
 */
export async function resetPassword(token: string, newPassword: string) {
  if (!newPassword || newPassword.length < 8) {
    return { success: false, error: "A senha deve ter pelo menos 6 caracteres." };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, status: true } } },
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { success: false, error: "Token inválido ou expirado." };
  }

  if (resetToken.user.status !== "ACTIVE") {
    return { success: false, error: "Usuário inativo." };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { success: true };
}
