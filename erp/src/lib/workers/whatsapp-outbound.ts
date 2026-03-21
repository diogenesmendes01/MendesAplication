import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { sendTextMessage, sendMediaMessage } from "@/lib/whatsapp-api";
import { generateSignedFileUrl } from "@/lib/file-token";
import { logger } from "@/lib/logger";

export interface WhatsAppOutboundJobData {
  messageId: string;
  ticketId: string;
  companyId: string;
  to: string;
  content: string;
  attachmentIds: string[];
}

export async function processWhatsAppOutbound(job: Job<WhatsAppOutboundJobData>) {
  const { messageId, companyId, to, content, attachmentIds } = job.data;

  // Find an active WHATSAPP channel for the company
  const channel = await prisma.channel.findFirst({
    where: { companyId, type: "WHATSAPP", isActive: true },
  });

  if (!channel) {
    logger.warn(`[whatsapp-outbound] No active WHATSAPP channel for company ${companyId}`);
    return;
  }

  // Mark as QUEUED
  await prisma.ticketMessage.update({
    where: { id: messageId },
    data: { deliveryStatus: "QUEUED" },
  });

  try {
    // Send text message
    const externalId = await sendTextMessage(companyId, to, content);

    // Send attachments as separate media messages
    if (attachmentIds.length > 0) {
      const attachments = await prisma.attachment.findMany({
        where: { id: { in: attachmentIds } },
      });

      for (const att of attachments) {
        const mediaUrl = generateSignedFileUrl(att.storagePath, {
          ttlSeconds: 15 * 60,
        });
        await sendMediaMessage(companyId, to, mediaUrl, att.fileName);
      }
    }

    // Update message with external ID and SENT status
    await prisma.ticketMessage.update({
      where: { id: messageId },
      data: {
        ...(externalId ? { externalId } : {}),
        deliveryStatus: "SENT",
      },
    });

    logger.info(`[whatsapp-outbound] Message sent to ${to}, externalId: ${externalId}`);
  } catch (err) {
    // Mark as FAILED
    await prisma.ticketMessage.update({
      where: { id: messageId },
      data: { deliveryStatus: "FAILED" },
    }).catch(() => {}); // Don't let status update failure mask the original error
    logger.error(`[whatsapp-outbound] Failed to send WhatsApp for message ${messageId}:`, err);
    throw err; // Let BullMQ retry
  }
}
