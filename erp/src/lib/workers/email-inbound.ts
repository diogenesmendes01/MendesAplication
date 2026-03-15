import { Job } from "bullmq";
import { ImapFlow } from "imapflow";
import type { FetchMessageObject, MessageStructureObject } from "imapflow";
import { prisma } from "@/lib/prisma";
import { decryptConfig } from "@/lib/encryption";
import { aiAgentQueue } from "@/lib/queue";
import path from "path";
import fs from "fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailChannelConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  email: string;
  password: string;
}

interface ChannelRecord {
  id: string;
  companyId: string;
  config: EmailChannelConfig;
  lastSyncUid: number | null;
  lastSyncUidSent: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeSubject(subject: string): string {
  // Strip Re:, Fwd:, Enc:, etc. prefixes and normalize whitespace
  return subject
    .replace(/^(re|fwd|fw|enc|res):\s*/gi, "")
    .replace(/^(re|fwd|fw|enc|res):\s*/gi, "") // handle double Re: Re:
    .trim();
}

function getAttachmentParts(structure: MessageStructureObject): MessageStructureObject[] {
  const parts: MessageStructureObject[] = [];

  if (structure.disposition === "attachment" || structure.disposition === "inline") {
    if (structure.dispositionParameters?.filename || structure.parameters?.name) {
      parts.push(structure);
    }
  }

  if (structure.childNodes) {
    for (const child of structure.childNodes) {
      parts.push(...getAttachmentParts(child));
    }
  }

  return parts;
}

async function saveAttachmentBuffer(
  buffer: Buffer,
  companyId: string,
  fileName: string
): Promise<{ storagePath: string; fileSize: number }> {
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
}

async function getOrCreateUnknownClient(companyId: string): Promise<string> {
  const UNKNOWN_CPFCNPJ = "00000000000";
  const existing = await prisma.client.findFirst({
    where: { companyId, cpfCnpj: UNKNOWN_CPFCNPJ },
    select: { id: true },
  });
  if (existing) return existing.id;

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

// ---------------------------------------------------------------------------
// IMAP fetch helpers
// ---------------------------------------------------------------------------

async function fetchAndProcessMailbox(
  client: ImapFlow,
  mailboxPath: string,
  lastUid: number | null,
  channel: ChannelRecord,
  isSent: boolean
): Promise<number | null> {
  let lock;
  try {
    lock = await client.getMailboxLock(mailboxPath, { readOnly: true });
  } catch {
    // Mailbox may not exist (e.g., Sent folder)
    console.log(`[email-inbound] Could not open mailbox ${mailboxPath} for channel ${channel.id}`);
    return lastUid;
  }

  let maxUid = lastUid;

  try {
    // Build UID range: fetch all messages with UID > lastUid
    const searchUid = lastUid ? `${lastUid + 1}:*` : "1:*";

    // Fetch envelope, bodyStructure, and source for each message
    for await (const msg of client.fetch(searchUid, {
      uid: true,
      envelope: true,
      bodyStructure: true,
      source: true,
    }, { uid: true })) {
      // Track max UID
      if (!maxUid || msg.uid > maxUid) {
        maxUid = msg.uid;
      }

      // Skip if same as lastUid (can happen with range "N:*")
      if (lastUid && msg.uid <= lastUid) continue;

      await processEmail(client, msg, channel, isSent);
    }
  } catch (err) {
    console.error(`[email-inbound] Error fetching ${mailboxPath} for channel ${channel.id}:`, err);
  } finally {
    lock.release();
  }

  return maxUid;
}

// ---------------------------------------------------------------------------
// Email processing
// ---------------------------------------------------------------------------

async function processEmail(
  client: ImapFlow,
  msg: FetchMessageObject,
  channel: ChannelRecord,
  isSent: boolean
): Promise<void> {
  const envelope = msg.envelope;
  if (!envelope) return;

  const messageId = envelope.messageId || null;
  const subject = envelope.subject || "(Sem assunto)";
  const fromAddresses = isSent ? (envelope.to || []) : (envelope.from || []);
  const senderAddress = (envelope.from || [])[0]?.address || "";

  // Deduplication by Message-ID
  if (messageId) {
    const existing = await prisma.ticketMessage.findFirst({
      where: { externalId: messageId, channel: "EMAIL" },
    });
    if (existing) {
      console.log(`[email-inbound] Duplicate email ${messageId}, skipping`);
      return;
    }
  }

  const companyId = channel.companyId;
  const direction = isSent ? "OUTBOUND" : "INBOUND";
  const origin = "EXTERNAL" as const;

  // Identify sender/recipient by email address
  const lookupEmail = isSent
    ? (fromAddresses[0]?.address || "")
    : senderAddress;

  let clientId: string | null = null;
  let contactId: string | null = null;

  if (lookupEmail) {
    const normalizedLookup = normalizeEmail(lookupEmail);

    // 1. Search Client.email
    const clientMatch = await prisma.client.findFirst({
      where: {
        companyId,
        email: { equals: normalizedLookup, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (clientMatch) {
      clientId = clientMatch.id;
    }

    // 2. Search AdditionalContact.email
    if (!clientId) {
      const contactMatch = await prisma.additionalContact.findFirst({
        where: {
          client: { companyId },
          email: { equals: normalizedLookup, mode: "insensitive" },
        },
        select: { id: true, clientId: true },
      });

      if (contactMatch) {
        clientId = contactMatch.clientId;
        contactId = contactMatch.id;
      }
    } else {
      // Client found, check if there's an AdditionalContact match too
      const contactMatch = await prisma.additionalContact.findFirst({
        where: {
          clientId,
          email: { equals: normalizedLookup, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (contactMatch) {
        contactId = contactMatch.id;
      }
    }
  }

  // Find or create ticket
  let ticketId: string;
  const normalizedSubject = normalizeSubject(subject);

  if (clientId) {
    // Look for existing open ticket with same (normalized) subject
    const existingTicket = await prisma.ticket.findFirst({
      where: {
        clientId,
        companyId,
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
        channelId: channel.id,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, subject: true },
    });

    // Match by subject similarity (strip Re:/Fwd: prefixes)
    if (existingTicket && normalizeSubject(existingTicket.subject) === normalizedSubject) {
      ticketId = existingTicket.id;
    } else if (existingTicket && envelope.inReplyTo) {
      // If it's a reply (has In-Reply-To header), try to match by that
      const replyMatch = await prisma.ticketMessage.findFirst({
        where: {
          externalId: envelope.inReplyTo,
          channel: "EMAIL",
          ticket: { companyId, clientId },
        },
        select: { ticketId: true },
      });
      ticketId = replyMatch ? replyMatch.ticketId : existingTicket.id;
    } else {
      // Create new ticket
      const clientRecord = await prisma.client.findUnique({
        where: { id: clientId },
        select: { name: true },
      });

      const ticket = await prisma.ticket.create({
        data: {
          clientId,
          companyId,
          subject: subject.substring(0, 200),
          description: `Email recebido de ${senderAddress}`,
          priority: "MEDIUM",
          channelId: channel.id,
          contactId: contactId ?? undefined,
          tags: [],
        },
      });
      ticketId = ticket.id;
      console.log(
        `[email-inbound] Created ticket ${ticketId} for client ${clientRecord?.name ?? clientId}`
      );
    }
  } else {
    // Unknown sender — create ticket with "Pendente Vinculação" tag
    const unknownClientId = await getOrCreateUnknownClient(companyId);
    const ticket = await prisma.ticket.create({
      data: {
        clientId: unknownClientId,
        companyId,
        subject: subject.substring(0, 200),
        description: `Email recebido de ${lookupEmail || senderAddress}. Remetente não identificado.`,
        priority: "MEDIUM",
        channelId: channel.id,
        tags: ["Pendente Vinculação"],
      },
    });
    ticketId = ticket.id;
    console.log(
      `[email-inbound] Created ticket ${ticketId} with tag "Pendente Vinculação" for ${lookupEmail || senderAddress}`
    );
  }

  // Extract text content from email source
  let textContent = "";
  if (msg.source) {
    // Simple text extraction from raw source — take text after headers
    const rawStr = msg.source.toString("utf-8");
    const headerEnd = rawStr.indexOf("\r\n\r\n");
    if (headerEnd > 0) {
      textContent = rawStr
        .substring(headerEnd + 4)
        .replace(/<[^>]*>/g, "") // strip HTML tags
        .replace(/=\r?\n/g, "") // handle quoted-printable line continuations
        .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))) // decode QP
        .trim()
        .substring(0, 5000); // limit content length
    }
  }

  if (!textContent) {
    textContent = `[Email] ${subject}`;
  }

  // Create ticket message
  const message = await prisma.ticketMessage.create({
    data: {
      ticketId,
      senderId: null,
      content: textContent,
      channel: "EMAIL",
      direction,
      origin,
      externalId: messageId || undefined,
      contactId: contactId ?? undefined,
      isInternal: false,
    },
  });

  // Save attachments
  if (msg.bodyStructure) {
    const attachmentParts = getAttachmentParts(msg.bodyStructure);
    for (const part of attachmentParts) {
      if (!part.part) continue;
      try {
        const fileName =
          part.dispositionParameters?.filename ||
          part.parameters?.name ||
          `attachment_${Date.now()}`;
        const mimeType = part.type || "application/octet-stream";

        const { content } = await client.download(String(msg.uid), part.part, { uid: true });
        const chunks: Buffer[] = [];
        for await (const chunk of content) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const buffer = Buffer.concat(chunks);

        if (buffer.length === 0) continue;

        const saved = await saveAttachmentBuffer(buffer, companyId, fileName);
        await prisma.attachment.create({
          data: {
            ticketId,
            ticketMessageId: message.id,
            fileName,
            fileSize: saved.fileSize,
            mimeType,
            storagePath: saved.storagePath,
          },
        });
        console.log(`[email-inbound] Saved attachment ${fileName} (${saved.fileSize} bytes)`);
      } catch (err) {
        console.error(`[email-inbound] Failed to save attachment:`, err);
      }
    }
  }

  console.log(
    `[email-inbound] Message ${message.id} added to ticket ${ticketId} (${direction}/${origin}, from: ${senderAddress}, msgId: ${messageId ?? "none"})`
  );

  // Enqueue AI agent job for inbound email messages with text content
  if (direction === "INBOUND" && textContent) {
    await aiAgentQueue.add("process-message", {
      ticketId,
      companyId,
      messageContent: textContent,
      channel: "EMAIL" as const,
    });
    console.log(
      `[email-inbound] Enqueued ai-agent job for ticket ${ticketId} (channel: EMAIL)`
    );
  }
}

// ---------------------------------------------------------------------------
// Find Sent folder path
// ---------------------------------------------------------------------------

async function findSentFolder(client: ImapFlow): Promise<string | null> {
  try {
    const mailboxes = await client.list();
    // Look for special-use \Sent flag
    for (const mb of mailboxes) {
      if (mb.specialUse === "\\Sent") {
        return mb.path;
      }
    }
    // Fallback: look for common names
    const sentNames = ["Sent", "INBOX.Sent", "Sent Messages", "Sent Items", "[Gmail]/Sent Mail"];
    for (const name of sentNames) {
      for (const mb of mailboxes) {
        if (mb.path.toLowerCase() === name.toLowerCase()) {
          return mb.path;
        }
      }
    }
  } catch (err) {
    console.error("[email-inbound] Error listing mailboxes:", err);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main processor — called by BullMQ repeatable job
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function processEmailInbound(_job: Job): Promise<void> {
  // Find all active EMAIL channels
  const channels = await prisma.channel.findMany({
    where: { type: "EMAIL", isActive: true },
    select: { id: true, companyId: true, config: true, lastSyncUid: true, lastSyncUidSent: true },
  });

  if (channels.length === 0) {
    console.log("[email-inbound] No active EMAIL channels found");
    return;
  }

  for (const ch of channels) {
    const config = decryptConfig(ch.config as Record<string, unknown>) as unknown as EmailChannelConfig;

    if (!config.imapHost || !config.email || !config.password) {
      console.warn(`[email-inbound] Channel ${ch.id} missing IMAP config, skipping`);
      continue;
    }

    const channelRecord: ChannelRecord = {
      id: ch.id,
      companyId: ch.companyId,
      config,
      lastSyncUid: ch.lastSyncUid,
      lastSyncUidSent: ch.lastSyncUidSent,
    };

    const imapClient = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort || 993,
      secure: (config.imapPort || 993) === 993,
      auth: {
        user: config.email,
        pass: config.password,
      },
      logger: false,
    });

    try {
      await imapClient.connect();
      console.log(`[email-inbound] Connected to IMAP for channel ${ch.id} (${config.email})`);

      // 1. Fetch Inbox (INBOUND messages)
      const newInboxUid = await fetchAndProcessMailbox(
        imapClient,
        "INBOX",
        ch.lastSyncUid,
        channelRecord,
        false
      );

      // 2. Fetch Sent folder (OUTBOUND messages captured externally)
      let newSentUid = ch.lastSyncUidSent;
      const sentPath = await findSentFolder(imapClient);
      if (sentPath) {
        newSentUid = await fetchAndProcessMailbox(
          imapClient,
          sentPath,
          ch.lastSyncUidSent,
          channelRecord,
          true
        );
      }

      // 3. Update channel sync state
      await prisma.channel.update({
        where: { id: ch.id },
        data: {
          lastSyncUid: newInboxUid ?? ch.lastSyncUid,
          lastSyncUidSent: newSentUid ?? ch.lastSyncUidSent,
          lastSyncAt: new Date(),
        },
      });

      console.log(
        `[email-inbound] Sync complete for channel ${ch.id}: inbox UID=${newInboxUid}, sent UID=${newSentUid}`
      );
    } catch (err) {
      console.error(`[email-inbound] Error processing channel ${ch.id}:`, err);
    } finally {
      try {
        await imapClient.logout();
      } catch {
        // Ignore logout errors
      }
    }
  }
}
