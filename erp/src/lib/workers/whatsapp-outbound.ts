import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { decryptConfig } from "@/lib/encryption";
import { sendTextMessage, sendMediaMessage } from "@/lib/evolution-api";

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

  const config = decryptConfig(channel.config as Record<string, unknown>);
  const instanceName = config.instanceName as string;

  if (!instanceName) {
    console.error(`[whatsapp-outbound] No instanceName in channel config ${channel.id}`);
    return;
  }

  try {
    // Send text message
    const externalId = await sendTextMessage(instanceName, to, content);

    // Send attachments as separate media messages
    if (attachmentIds.length > 0) {
      const attachments = await prisma.attachment.findMany({
        where: { id: { in: attachmentIds } },
      });

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      for (const att of attachments) {
        const mediaUrl = `${baseUrl}/api/files/${att.storagePath}`;
        await sendMediaMessage(instanceName, to, mediaUrl, att.fileName);
      }
    }

    // Update message with external ID
    if (externalId) {
      await prisma.ticketMessage.update({
        where: { id: messageId },
        data: { externalId },
      });
    }

    console.log(`[whatsapp-outbound] Message sent to ${to}, externalId: ${externalId}`);
  } catch (err) {
    console.error(`[whatsapp-outbound] Failed to send WhatsApp for message ${messageId}:`, err);
    throw err; // Let BullMQ retry
  }
}
