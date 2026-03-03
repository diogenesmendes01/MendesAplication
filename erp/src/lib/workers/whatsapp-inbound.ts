import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { aiAgentQueue } from "@/lib/queue";
import { decryptConfig } from "@/lib/encryption";
import path from "path";
import fs from "fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      imageMessage?: {
        url?: string;
        mimetype?: string;
        caption?: string;
        fileLength?: string;
        fileName?: string;
      };
      documentMessage?: {
        url?: string;
        mimetype?: string;
        caption?: string;
        fileLength?: string;
        fileName?: string;
        title?: string;
      };
      audioMessage?: {
        url?: string;
        mimetype?: string;
        fileLength?: string;
      };
      videoMessage?: {
        url?: string;
        mimetype?: string;
        caption?: string;
        fileLength?: string;
        fileName?: string;
      };
    };
    messageType?: string;
    messageTimestamp?: number;
    media?: {
      url?: string;
      base64?: string;
      mimetype?: string;
      fileName?: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPhoneDigits(jid: string): string {
  // Remove @s.whatsapp.net or @g.us suffix and non-digit chars
  return jid.replace(/@.*$/, "").replace(/\D/g, "");
}

function normalizeDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function extractTextContent(message: EvolutionWebhookPayload["data"]["message"]): string {
  if (!message) return "";
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.documentMessage?.title) return message.documentMessage.title;
  return "";
}

function getMediaInfo(
  data: EvolutionWebhookPayload["data"]
): { url?: string; base64?: string; mimetype: string; fileName: string } | null {
  const msg = data.message;
  if (!msg) return null;

  // Check for media in data.media (Evolution API v2 format)
  if (data.media?.url || data.media?.base64) {
    return {
      url: data.media.url,
      base64: data.media.base64,
      mimetype: data.media.mimetype || "application/octet-stream",
      fileName: data.media.fileName || `media_${Date.now()}`,
    };
  }

  // Check image
  if (msg.imageMessage?.url) {
    return {
      url: msg.imageMessage.url,
      mimetype: msg.imageMessage.mimetype || "image/jpeg",
      fileName: msg.imageMessage.fileName || `image_${Date.now()}.jpg`,
    };
  }

  // Check document
  if (msg.documentMessage?.url) {
    return {
      url: msg.documentMessage.url,
      mimetype: msg.documentMessage.mimetype || "application/octet-stream",
      fileName:
        msg.documentMessage.fileName ||
        msg.documentMessage.title ||
        `document_${Date.now()}`,
    };
  }

  // Check video
  if (msg.videoMessage?.url) {
    return {
      url: msg.videoMessage.url,
      mimetype: msg.videoMessage.mimetype || "video/mp4",
      fileName: msg.videoMessage.fileName || `video_${Date.now()}.mp4`,
    };
  }

  // Check audio
  if (msg.audioMessage?.url) {
    return {
      url: msg.audioMessage.url,
      mimetype: msg.audioMessage.mimetype || "audio/ogg",
      fileName: `audio_${Date.now()}.ogg`,
    };
  }

  return null;
}

async function downloadAndSaveMedia(
  mediaUrl: string,
  companyId: string,
  fileName: string
): Promise<{ storagePath: string; fileSize: number } | null> {
  try {
    const res = await fetch(mediaUrl);
    if (!res.ok) {
      console.error(`[whatsapp-inbound] Failed to download media: ${res.status}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const uploadsDir = path.join(process.cwd(), "uploads");
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const storageDir = path.join(companyId, yearMonth);
    const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_").substring(0, 100);
    const storagePath = path.join(storageDir, `${Date.now()}_${safeName}`);
    const fullPath = path.join(uploadsDir, storagePath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);

    return { storagePath, fileSize: buffer.length };
  } catch (err) {
    console.error("[whatsapp-inbound] Failed to save media:", err);
    return null;
  }
}

async function saveBase64Media(
  base64: string,
  companyId: string,
  fileName: string
): Promise<{ storagePath: string; fileSize: number } | null> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const uploadsDir = path.join(process.cwd(), "uploads");
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const storageDir = path.join(companyId, yearMonth);
    const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_").substring(0, 100);
    const storagePath = path.join(storageDir, `${Date.now()}_${safeName}`);
    const fullPath = path.join(uploadsDir, storagePath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);

    return { storagePath, fileSize: buffer.length };
  } catch (err) {
    console.error("[whatsapp-inbound] Failed to save base64 media:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processWhatsAppInbound(job: Job<EvolutionWebhookPayload>) {
  const payload = job.data;
  const instanceName = payload.instance;
  const data = payload.data;

  if (!data?.key) {
    console.warn("[whatsapp-inbound] Missing data.key in payload");
    return;
  }

  // Skip group messages
  if (data.key.remoteJid.endsWith("@g.us")) {
    return;
  }

  const externalId = data.key.id;
  const fromMe = data.key.fromMe;
  const phone = extractPhoneDigits(data.key.remoteJid);
  const pushName = data.pushName ?? "";
  const content = extractTextContent(data.message);

  // Skip status broadcast messages
  if (data.key.remoteJid === "status@broadcast") {
    return;
  }

  // Find Channel by instanceName (need to check all active WHATSAPP channels)
  const channels = await prisma.channel.findMany({
    where: { type: "WHATSAPP", isActive: true },
    select: { id: true, companyId: true, config: true },
  });

  let channel: { id: string; companyId: string } | null = null;
  for (const ch of channels) {
    const config = decryptConfig(ch.config as Record<string, unknown>);
    if (config.instanceName === instanceName) {
      channel = { id: ch.id, companyId: ch.companyId };
      break;
    }
  }

  if (!channel) {
    console.warn(`[whatsapp-inbound] No channel found for instance: ${instanceName}`);
    return;
  }

  const companyId = channel.companyId;

  // Deduplication by externalId
  if (externalId) {
    const existing = await prisma.ticketMessage.findFirst({
      where: { externalId, channel: "WHATSAPP" },
    });
    if (existing) {
      console.log(`[whatsapp-inbound] Duplicate message ${externalId}, skipping`);
      return;
    }
  }

  // Determine direction and origin
  const direction = fromMe ? "OUTBOUND" : "INBOUND";
  const origin = "EXTERNAL" as const;

  // Identify sender by phone number
  let clientId: string | null = null;
  let contactId: string | null = null;

  // 1. Search Client.telefone
  const clients = await prisma.client.findMany({
    where: { companyId },
    select: { id: true, telefone: true },
  });

  for (const c of clients) {
    if (c.telefone && normalizeDigits(c.telefone) === phone) {
      clientId = c.id;
      break;
    }
    // Try matching last 8+ digits for flexible phone format matching
    if (c.telefone) {
      const storedDigits = normalizeDigits(c.telefone);
      if (
        storedDigits.length >= 8 &&
        phone.length >= 8 &&
        (phone.endsWith(storedDigits.slice(-11)) ||
          storedDigits.endsWith(phone.slice(-11)))
      ) {
        clientId = c.id;
        break;
      }
    }
  }

  // 2. Search AdditionalContact.whatsapp
  if (!clientId) {
    const contacts = await prisma.additionalContact.findMany({
      where: { client: { companyId } },
      select: { id: true, clientId: true, whatsapp: true },
    });

    for (const c of contacts) {
      if (c.whatsapp && normalizeDigits(c.whatsapp) === phone) {
        clientId = c.clientId;
        contactId = c.id;
        break;
      }
      if (c.whatsapp) {
        const storedDigits = normalizeDigits(c.whatsapp);
        if (
          storedDigits.length >= 8 &&
          phone.length >= 8 &&
          (phone.endsWith(storedDigits.slice(-11)) ||
            storedDigits.endsWith(phone.slice(-11)))
        ) {
          clientId = c.clientId;
          contactId = c.id;
          break;
        }
      }
    }
  } else {
    // Client found by primary phone, check if there's also an AdditionalContact match
    const additionalContact = await prisma.additionalContact.findFirst({
      where: { clientId },
      select: { id: true, whatsapp: true },
    });
    // Use AdditionalContact if it has a whatsapp matching this phone
    if (additionalContact?.whatsapp) {
      const storedDigits = normalizeDigits(additionalContact.whatsapp);
      if (
        storedDigits === phone ||
        phone.endsWith(storedDigits.slice(-11)) ||
        storedDigits.endsWith(phone.slice(-11))
      ) {
        contactId = additionalContact.id;
      }
    }
  }

  // Find or create ticket
  let ticketId: string;
  const tags: string[] = [];

  if (clientId) {
    // Look for an existing open ticket with this client on WHATSAPP channel
    const existingTicket = await prisma.ticket.findFirst({
      where: {
        clientId,
        companyId,
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
        channelId: channel.id,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    if (existingTicket) {
      ticketId = existingTicket.id;
    } else {
      // Create new ticket for known client
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: { name: true },
      });

      const ticket = await prisma.ticket.create({
        data: {
          clientId,
          companyId,
          subject: content
            ? content.substring(0, 100)
            : `WhatsApp de ${pushName || phone}`,
          description: content || `Mensagem recebida via WhatsApp de ${pushName || phone}`,
          priority: "MEDIUM",
          channelId: channel.id,
          contactId: contactId ?? undefined,
          tags: [],
        },
      });
      ticketId = ticket.id;
      console.log(
        `[whatsapp-inbound] Created ticket ${ticketId} for client ${client?.name ?? clientId}`
      );
    }
  } else {
    // Unknown sender — create ticket with "Pendente Vinculação" tag
    tags.push("Pendente Vinculação");

    const ticket = await prisma.ticket.create({
      data: {
        // We need a clientId but don't have one — use a placeholder approach:
        // Create without client or find a way to handle
        // Since Ticket.clientId is required, we need to handle this differently.
        // Check if there's a "generic" client or create a system one for unlinked messages.
        clientId: await getOrCreateUnknownClient(companyId),
        companyId,
        subject: content
          ? content.substring(0, 100)
          : `WhatsApp de ${pushName || phone}`,
        description: `Mensagem recebida via WhatsApp de ${pushName || phone}. Número: ${phone}`,
        priority: "MEDIUM",
        channelId: channel.id,
        tags: ["Pendente Vinculação"],
      },
    });
    ticketId = ticket.id;
    console.log(
      `[whatsapp-inbound] Created ticket ${ticketId} with tag "Pendente Vinculação" for ${phone}`
    );
  }

  // Save attachments if media message
  let attachmentId: string | undefined;
  const mediaInfo = getMediaInfo(data);
  if (mediaInfo) {
    let saved: { storagePath: string; fileSize: number } | null = null;

    if (mediaInfo.url) {
      saved = await downloadAndSaveMedia(mediaInfo.url, companyId, mediaInfo.fileName);
    } else if (mediaInfo.base64) {
      saved = await saveBase64Media(mediaInfo.base64, companyId, mediaInfo.fileName);
    }

    if (saved) {
      const attachment = await prisma.attachment.create({
        data: {
          ticketId,
          fileName: mediaInfo.fileName,
          fileSize: saved.fileSize,
          mimeType: mediaInfo.mimetype,
          storagePath: saved.storagePath,
        },
      });
      attachmentId = attachment.id;
    }
  }

  // Create ticket message
  const message = await prisma.ticketMessage.create({
    data: {
      ticketId,
      senderId: null,
      content: content || (mediaInfo ? `[${mediaInfo.fileName}]` : "[Mensagem sem conteúdo]"),
      channel: "WHATSAPP",
      direction,
      origin,
      externalId: externalId || undefined,
      contactId: contactId ?? undefined,
      isInternal: false,
    },
  });

  // Link attachment to message if saved
  if (attachmentId) {
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { ticketMessageId: message.id },
    });
  }

  console.log(
    `[whatsapp-inbound] Message ${message.id} added to ticket ${ticketId} (${direction}/${origin}, phone: ${phone})`
  );

  // Enqueue AI agent job for inbound messages with text content
  if (direction === "INBOUND" && content) {
    await aiAgentQueue.add("process-message", {
      ticketId,
      companyId,
      messageContent: content,
    });
    console.log(
      `[whatsapp-inbound] Enqueued ai-agent job for ticket ${ticketId}`
    );
  }
}

// ---------------------------------------------------------------------------
// Unknown client helper
// ---------------------------------------------------------------------------

async function getOrCreateUnknownClient(companyId: string): Promise<string> {
  // Use a well-known "unknown" client per company for unlinked WhatsApp messages
  const UNKNOWN_CPFCNPJ = "00000000000";

  const existing = await prisma.client.findFirst({
    where: { companyId, cpfCnpj: UNKNOWN_CPFCNPJ },
    select: { id: true },
  });

  if (existing) {
    return existing.id;
  }

  const client = await prisma.client.create({
    data: {
      name: "Contato Desconhecido",
      razaoSocial: "Contato Desconhecido",
      cpfCnpj: UNKNOWN_CPFCNPJ,
      type: "PF",
      companyId,
    },
  });

  return client.id;
}
