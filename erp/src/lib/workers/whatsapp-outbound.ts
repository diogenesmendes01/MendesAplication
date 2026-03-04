import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { sendTextMessage, sendMediaMessage } from "@/lib/whatsapp-api";

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
    console.warn(`[whatsapp-outbound] No active WHATSAPP channel for company ${companyId}`);
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

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      for (const att of attachments) {
        const mediaUrl = `${baseUrl}/api/files/${att.storagePath}`;
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

    console.log(`[whatsapp-outbound] Message sent to ${to}, externalId: ${externalId}`);
  } catch (err) {
    // Mark as FAILED
    await prisma.ticketMessage.update({
      where: { id: messageId },
      data: { deliveryStatus: "FAILED" },
    }).catch(() => {}); // Don't let status update failure mask the original error
    console.error(`[whatsapp-outbound] Failed to send WhatsApp for message ${messageId}:`, err);
    throw err; // Let BullMQ retry
  }
}
