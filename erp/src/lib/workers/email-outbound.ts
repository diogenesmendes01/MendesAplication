import { sanitizeEmailHtml } from "@/lib/ai/sanitize-utils";
import { Job } from "bullmq";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { decryptConfig } from "@/lib/encryption";
import path from "path";
import { logger } from "@/lib/logger";

export interface EmailOutboundJobData {
  messageId: string;
  ticketId: string;
  companyId: string;
  to: string;
  subject: string;
  content: string;
  attachmentIds: string[];
}

export async function processEmailOutbound(job: Job<EmailOutboundJobData>) {
  const { messageId, companyId, to, subject, content, attachmentIds } = job.data;

  // Find an active EMAIL channel for the company
  const channel = await prisma.channel.findFirst({
    where: { companyId, type: "EMAIL", isActive: true },
  });

  if (!channel) {
    logger.warn(`[email-outbound] No active EMAIL channel for company ${companyId}`);
    return;
  }

  const config = decryptConfig(channel.config as Record<string, unknown>);

  const smtpHost = config.smtpHost as string;
  const smtpPort = Number(config.smtpPort ?? 587);
  const smtpUser = config.email as string;
  const smtpPass = config.password as string;

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.error(`[email-outbound] Incomplete SMTP config for channel ${channel.id}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  // Prepare attachments
  const attachments: nodemailer.SendMailOptions["attachments"] = [];
  if (attachmentIds.length > 0) {
    const attachmentRecords = await prisma.attachment.findMany({
      where: { id: { in: attachmentIds } },
    });
    for (const att of attachmentRecords) {
      if (att.storagePath) {
        attachments.push({
          filename: att.fileName,
          path: path.join(process.cwd(), "uploads", att.storagePath),
        });
      } else if (att.externalUrl) {
        attachments.push({
          filename: att.fileName,
          path: att.externalUrl,
        });
      }
    }
  }

  try {
    const info = await transporter.sendMail({
      from: smtpUser,
      to,
      subject,
      html: `<div style="font-family: Arial, sans-serif;">${sanitizeEmailHtml(content.replace(/\n/g, "<br>"))}</div>`,
      attachments,
    });

    // Update message with SMTP Message-ID as externalId
    const externalId = info.messageId;
    if (externalId) {
      await prisma.ticketMessage.update({
        where: { id: messageId },
        data: { externalId },
      });
    }

    logger.info(`[email-outbound] Email sent to ${to}, messageId: ${externalId}`);
  } catch (err) {
    logger.error({ err: err }, `[email-outbound] Failed to send email for message ${messageId}:`);
    throw err; // Let BullMQ retry
  }
}
