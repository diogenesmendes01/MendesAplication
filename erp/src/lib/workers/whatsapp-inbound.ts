import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { aiAgentQueue } from "@/lib/queue";
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
    unresolvedLid?: boolean;
    originalJid?: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPhoneDigits(jid: string): string {
  // Remove @s.whatsapp.net or @g.us suffix and non-digit chars
  return jid.replace(/@.*$/, "").replace(/\D/g, "");
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
  const rawPhone = extractPhoneDigits(data.key.remoteJid);
  const pushName = data.pushName ?? "";
  const content = extractTextContent(data.message);
  const unresolvedLid = data.unresolvedLid === true;

  // If LID was not resolved, the "phone" is actually a WhatsApp internal ID (14+ digits)
  // Use it as identifier but mark it clearly
  const phone = rawPhone;

  // Skip status broadcast messages
  if (data.key.remoteJid === "status@broadcast") {
    return;
  }

  // Find Channel by companyId (WhatsApp Service sends companyId as instance)
  const foundChannel = await prisma.channel.findFirst({
    where: { companyId: instanceName, type: "WHATSAPP", isActive: true },
    select: { id: true, companyId: true },
  });

  if (!foundChannel) {
    console.warn(`[whatsapp-inbound] No channel found for companyId: ${instanceName}`);
    return;
  }

  const channel = foundChannel;

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

  // Extract suffix for flexible matching (last 11 digits covers BR mobile with area code)
  const phoneSuffix = phone.length >= 11 ? phone.slice(-11) : phone;

  // 1. Search Client.telefone using DB-level filtering
  const matchedClient = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "clients"
    WHERE "companyId" = ${companyId}
      AND REGEXP_REPLACE("telefone", '[^0-9]', '', 'g') LIKE ${'%' + phoneSuffix}
    LIMIT 1
  `;

  if (matchedClient.length > 0) {
    clientId = matchedClient[0].id;
  }

  // 2. Search AdditionalContact.whatsapp if no client found
  if (!clientId) {
    const matchedContact = await prisma.$queryRaw<{ id: string; clientId: string }[]>`
      SELECT ac.id, ac."clientId"
      FROM "additional_contacts" ac
      JOIN "clients" c ON c.id = ac."clientId"
      WHERE c."companyId" = ${companyId}
        AND REGEXP_REPLACE(ac."whatsapp", '[^0-9]', '', 'g') LIKE ${'%' + phoneSuffix}
      LIMIT 1
    `;

    if (matchedContact.length > 0) {
      clientId = matchedContact[0].clientId;
      contactId = matchedContact[0].id;
    }
  } else {
    // Client found by primary phone, check if there's also an AdditionalContact match
    const additionalContact = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "additional_contacts"
      WHERE "clientId" = ${clientId}
        AND REGEXP_REPLACE("whatsapp", '[^0-9]', '', 'g') LIKE ${'%' + phoneSuffix}
      LIMIT 1
    `;
    if (additionalContact.length > 0) {
      contactId = additionalContact[0].id;
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
    // Unknown sender — check if there's already an open ticket from this phone number
    const unknownClientId = await getOrCreateUnknownClient(companyId);

    // Search for existing open ticket with matching phone in description or subject
    const existingUnknownTicket = await prisma.ticket.findFirst({
      where: {
        clientId: unknownClientId,
        companyId,
        channelId: channel.id,
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
        description: { contains: phone },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    if (existingUnknownTicket) {
      ticketId = existingUnknownTicket.id;
    } else {
      tags.push("Pendente Vinculação");
      const phoneLabel = unresolvedLid
        ? `${pushName || "Desconhecido"} (ID: ${phone})`
        : (pushName || phone);
      const ticket = await prisma.ticket.create({
        data: {
          clientId: unknownClientId,
          companyId,
          subject: content
            ? content.substring(0, 100)
            : `WhatsApp de ${phoneLabel}`,
          description: `Mensagem recebida via WhatsApp de ${phoneLabel}. Número: ${phone}. WhatsApp JID: ${data.key.remoteJid}`,
          priority: "MEDIUM",
          channelId: channel.id,
          tags: unresolvedLid
            ? ["Pendente Vinculação", "LID Não Resolvido"]
            : ["Pendente Vinculação"],
        },
      });
      ticketId = ticket.id;
      console.log(
        `[whatsapp-inbound] Created ticket ${ticketId} with tag "Pendente Vinculação" for ${phone}`
      );
    }
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
