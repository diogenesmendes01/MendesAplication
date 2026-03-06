import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  getContentType,
  isLidUser,
  jidNormalizedUser,
  type WAMessage,
  type AnyMessageContent,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../lib/prisma.js";
import { useDatabaseAuthState } from "./useDatabaseAuthState.js";

const WEBHOOK_URL =
  process.env.WHATSAPP_WEBHOOK_URL || "http://localhost:3000/api/webhooks/whatsapp";
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || "";
const SERVICE_PORT = process.env.WHATSAPP_SERVICE_PORT || "3001";
const SERVICE_BASE_URL =
  process.env.WHATSAPP_SERVICE_BASE_URL || `http://localhost:${SERVICE_PORT}`;

// ============================================
// Types
// ============================================

export interface BaileysSession {
  companyId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket: any;
  qrCode?: string;
  pairingCode?: string;
  phoneNumber?: string;
  pairingMethod: "qr" | "code";
  isConnected: boolean;
  isConnecting: boolean;
  lastError?: string;
}

// ============================================
// BaileysProvider class
// ============================================

class BaileysProvider {
  private sessions = new Map<string, BaileysSession>();
  private lastInitAttemptAt = new Map<string, number>();
  private reconnectBackoffMs = new Map<string, number>();
  private pendingRetry = new Set<string>();

  private static readonly COOLDOWN_MS = 15_000;
  private static readonly BACKOFF_INITIAL_MS = 5_000;
  private static readonly BACKOFF_MAX_MS = 60_000;

  // ============================================
  // QR Code Connection Flow
  // ============================================

  async initiateQrCode(
    companyId: string,
    bypassCooldown = false
  ): Promise<void> {
    // Cooldown check
    if (!bypassCooldown) {
      const lastAttempt = this.lastInitAttemptAt.get(companyId);
      if (
        lastAttempt &&
        Date.now() - lastAttempt < BaileysProvider.COOLDOWN_MS
      ) {
        console.log(
          `[BaileysProvider] Cooldown active for ${companyId}, skipping`
        );
        return;
      }
    }
    this.lastInitAttemptAt.set(companyId, Date.now());

    // If already connecting, skip
    const existing = this.sessions.get(companyId);
    if (existing?.isConnecting && existing.socket) {
      console.log(
        `[BaileysProvider] Session ${companyId} already connecting, skipping`
      );
      return;
    }

    // If connected, disconnect first
    if (existing?.isConnected) {
      await this.disconnect(companyId);
    }

    // Clean old credentials for fresh start
    await this.clearAuthState(companyId);

    // Create placeholder session
    this.sessions.set(companyId, {
      companyId,
      socket: null,
      pairingMethod: "qr",
      isConnected: false,
      isConnecting: true,
    });

    await this.createSocket(companyId, "qr");
  }

  // ============================================
  // Pairing Code Connection Flow
  // ============================================

  async initiatePairingCode(
    companyId: string,
    phoneNumber: string,
    bypassCooldown = false
  ): Promise<void> {
    // Validate phone number (digits only, 10-15 chars)
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      throw new Error(
        "Invalid phone number. Must be 10-15 digits including country code."
      );
    }

    // Cooldown check
    if (!bypassCooldown) {
      const lastAttempt = this.lastInitAttemptAt.get(companyId);
      if (
        lastAttempt &&
        Date.now() - lastAttempt < BaileysProvider.COOLDOWN_MS
      ) {
        console.log(
          `[BaileysProvider] Cooldown active for ${companyId}, skipping`
        );
        return;
      }
    }
    this.lastInitAttemptAt.set(companyId, Date.now());

    // If already connecting, skip
    const existing = this.sessions.get(companyId);
    if (existing?.isConnecting && existing.socket) {
      return;
    }

    // If connected, disconnect first
    if (existing?.isConnected) {
      await this.disconnect(companyId);
    }

    // Clean old credentials for fresh start
    await this.clearAuthState(companyId);

    // Create placeholder session
    this.sessions.set(companyId, {
      companyId,
      socket: null,
      phoneNumber: cleanPhone,
      pairingMethod: "code",
      isConnected: false,
      isConnecting: true,
    });

    await this.createSocket(companyId, "code", cleanPhone);
  }

  // ============================================
  // Get QR Code (polling)
  // ============================================

  async getQrCode(companyId: string): Promise<string | null> {
    const session = this.sessions.get(companyId);
    if (!session) {
      return null;
    }

    if (session.isConnected) {
      return null;
    }

    // If QR code already available, return it
    if (session.qrCode) {
      return session.qrCode;
    }

    // Poll for QR code (up to 30 seconds)
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const current = this.sessions.get(companyId);
      if (!current || current.isConnected) {
        return null;
      }
      if (current.qrCode) {
        return current.qrCode;
      }
    }

    return null;
  }

  // ============================================
  // Get Pairing Code (polling)
  // ============================================

  async getPairingCode(companyId: string): Promise<string | null> {
    const session = this.sessions.get(companyId);
    if (!session) {
      return null;
    }

    if (session.isConnected) {
      return null;
    }

    if (session.pairingMethod !== "code") {
      return null;
    }

    // If pairing code already available, return it
    if (session.pairingCode) {
      return session.pairingCode;
    }

    // Poll for pairing code (up to 30 seconds)
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const current = this.sessions.get(companyId);
      if (!current || current.isConnected) {
        return null;
      }
      if (current.pairingCode) {
        return current.pairingCode;
      }
    }

    return null;
  }

  // ============================================
  // Disconnect
  // ============================================

  async disconnect(companyId: string): Promise<void> {
    const session = this.sessions.get(companyId);
    if (!session) {
      return;
    }

    try {
      if (session.socket) {
        session.socket.end(undefined);
        // Wait briefly for cleanup
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error(`[BaileysProvider] Error disconnecting ${companyId}:`, err);
    }

    this.sessions.delete(companyId);

    // Clean auth state from DB
    await this.clearAuthState(companyId);

    console.log(`[BaileysProvider] Disconnected ${companyId}`);
  }

  // ============================================
  // Get Connection Status
  // ============================================

  getConnectionStatus(companyId: string): {
    isConnected: boolean;
    isConnecting: boolean;
    lastError?: string;
  } {
    const session = this.sessions.get(companyId);
    if (!session) {
      return {
        isConnected: false,
        isConnecting: false,
      };
    }

    return {
      isConnected: session.isConnected,
      isConnecting: session.isConnecting,
      lastError: session.lastError,
    };
  }

  // ============================================
  // Get Session (for message sending in US-006)
  // ============================================

  getSession(companyId: string): BaileysSession | undefined {
    return this.sessions.get(companyId);
  }

  // ============================================
  // Send Text Message
  // ============================================

  async sendMessage(
    companyId: string,
    to: string,
    content: string
  ): Promise<string> {
    const session = this.sessions.get(companyId);
    if (!session) {
      throw new Error(`Session not found for ${companyId}`);
    }
    if (!session.isConnected || !session.socket) {
      throw new Error(`Session ${companyId} is not connected`);
    }

    const jid = this.normalizeJid(to);
    const result = await session.socket.sendMessage(jid, { text: content });
    return result.key.id;
  }

  // ============================================
  // Send Media Message
  // ============================================

  async sendMediaMessage(
    companyId: string,
    to: string,
    mediaUrl: string,
    caption?: string,
    mediaType: "image" | "video" | "audio" | "document" = "image"
  ): Promise<string> {
    const session = this.sessions.get(companyId);
    if (!session) {
      throw new Error(`Session not found for ${companyId}`);
    }
    if (!session.isConnected || !session.socket) {
      throw new Error(`Session ${companyId} is not connected`);
    }

    const jid = this.normalizeJid(to);
    let messageContent: AnyMessageContent;

    switch (mediaType) {
      case "image":
        messageContent = caption
          ? { image: { url: mediaUrl }, caption }
          : { image: { url: mediaUrl } };
        break;
      case "video":
        messageContent = caption
          ? { video: { url: mediaUrl }, caption }
          : { video: { url: mediaUrl } };
        break;
      case "audio":
        messageContent = { audio: { url: mediaUrl } };
        break;
      case "document":
        messageContent = caption
          ? {
              document: { url: mediaUrl },
              mimetype: "application/octet-stream",
              caption,
            }
          : {
              document: { url: mediaUrl },
              mimetype: "application/octet-stream",
            };
        break;
    }

    const result = await session.socket.sendMessage(jid, messageContent);
    return result.key.id;
  }

  // ============================================
  // PRIVATE: Create Socket
  // ============================================

  private async createSocket(
    companyId: string,
    method: "qr" | "code",
    phoneNumber?: string
  ): Promise<void> {
    try {
      const { version } = await fetchLatestBaileysVersion();
      const { state, saveCreds } = await useDatabaseAuthState(companyId);

      const socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined as never),
        },
        browser:
          method === "code"
            ? Browsers.macOS("Chrome")
            : Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        emitOwnEvents: false,
        connectTimeoutMs: 30_000,
        defaultQueryTimeoutMs: 15_000,
        keepAliveIntervalMs: 25_000,
        getMessage: async () => {
          return undefined;
        },
      });

      // Register creds update handler
      socket.ev.on("creds.update", saveCreds);

      // Setup connection update handler
      this.setupConnectionHandler(socket, companyId, saveCreds);

      // Setup message handler (incoming messages, media download, webhook dispatch)
      this.setupMessageHandler(socket, companyId);

      // Update session with real socket
      const session = this.sessions.get(companyId);
      if (session) {
        session.socket = socket;
      }

      // Reset backoff on successful socket creation
      this.reconnectBackoffMs.delete(companyId);

      // Handle pairing code request
      if (method === "code" && phoneNumber && !state.creds.registered) {
        // Wait for socket readiness
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const code = await socket.requestPairingCode(phoneNumber);
          // Format as XXXX-XXXX
          const formatted = (code.match(/.{1,4}/g) || []).join("-");
          const currentSession = this.sessions.get(companyId);
          if (currentSession) {
            currentSession.pairingCode = formatted;
          }
          console.log(
            `[BaileysProvider] Pairing code for ${companyId}: ${formatted}`
          );
        } catch (err) {
          console.error(
            `[BaileysProvider] Error requesting pairing code for ${companyId}:`,
            err
          );
          const currentSession = this.sessions.get(companyId);
          if (currentSession) {
            currentSession.isConnecting = false;
            currentSession.lastError = "Failed to generate pairing code";
          }
        }
      }

      console.log(
        `[BaileysProvider] Socket created for ${companyId} (method: ${method})`
      );
    } catch (err) {
      console.error(
        `[BaileysProvider] Error creating socket for ${companyId}:`,
        err
      );
      const session = this.sessions.get(companyId);
      if (session) {
        session.isConnecting = false;
        session.lastError =
          err instanceof Error ? err.message : "Socket creation failed";
      }
    }
  }

  // ============================================
  // PRIVATE: Setup Connection Handler
  // ============================================

  private setupConnectionHandler(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket: any,
    companyId: string,
    saveCreds: () => Promise<void>
  ): void {
    socket.ev.on(
      "connection.update",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (update: any) => {
        const { connection, lastDisconnect, qr } = update;
        const session = this.sessions.get(companyId);
        if (!session) return;

        // ---- QR Code received ----
        if (qr) {
          try {
            const qrBase64 = await QRCode.toDataURL(qr);
            session.qrCode = qrBase64;
            console.log(`[BaileysProvider] QR code generated for ${companyId}`);
          } catch (err) {
            console.error(
              `[BaileysProvider] Error generating QR for ${companyId}:`,
              err
            );
          }
        }

        // ---- Connection OPEN ----
        if (connection === "open") {
          session.isConnected = true;
          session.isConnecting = false;
          session.qrCode = undefined;
          session.pairingCode = undefined;
          session.lastError = undefined;
          console.log(
            `[BaileysProvider] Connected: ${companyId}`
          );
        }

        // ---- Connection CLOSE ----
        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom)?.output
            ?.statusCode;
          const errorMessage =
            (lastDisconnect?.error as Error)?.message || "";
          const wasConnected = session.isConnected;

          console.log(
            `[BaileysProvider] Connection closed for ${companyId}: status=${statusCode}, wasConnected=${wasConnected}, error=${errorMessage}`
          );

          session.isConnected = false;
          session.qrCode = undefined;
          session.pairingCode = undefined;

          // ---- 401: loggedOut / device_removed ----
          if (
            statusCode === DisconnectReason.loggedOut ||
            errorMessage.includes("device_removed")
          ) {
            session.isConnecting = false;
            session.lastError =
              "Device was removed from WhatsApp. Please reconnect by scanning a new QR code.";
            // Full wipe (auth + LID mappings): device is gone, mappings are stale
            await this.clearAuthStateFull(companyId);
            console.log(
              `[BaileysProvider] Device removed for ${companyId}, NOT reconnecting`
            );
            return;
          }

          // ---- 515: restartRequired ----
          if (statusCode === DisconnectReason.restartRequired) {
            session.isConnecting = true;
            console.log(
              `[BaileysProvider] Restart required for ${companyId}, reconnecting immediately`
            );
            // End old socket gracefully
            try {
              socket.end(undefined);
            } catch {
              // ignore
            }
            // Recreate socket with same credentials (immediate, bypass cooldown)
            setImmediate(async () => {
              try {
                await this.createSocket(
                  companyId,
                  session.pairingMethod,
                  session.phoneNumber
                );
              } catch (err) {
                console.error(
                  `[BaileysProvider] Error reconnecting ${companyId} after restartRequired:`,
                  err
                );
              }
            });
            return;
          }

          // ---- 408: QR timeout ----
          if (
            statusCode === DisconnectReason.timedOut &&
            !wasConnected
          ) {
            session.isConnecting = false;
            session.lastError =
              "QR code expired. Please request a new connection.";
            console.log(
              `[BaileysProvider] QR timeout for ${companyId}, NOT reconnecting`
            );
            return;
          }

          // ---- Was connected: reconnect with exponential backoff ----
          if (wasConnected) {
            const shouldReconnect =
              statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
              const current =
                this.reconnectBackoffMs.get(companyId) ||
                BaileysProvider.BACKOFF_INITIAL_MS;
              const next = Math.min(
                current * 2,
                BaileysProvider.BACKOFF_MAX_MS
              );
              this.reconnectBackoffMs.set(companyId, next);

              session.isConnecting = true;
              session.lastError = `Reconnecting in ${current / 1000}s...`;

              console.log(
                `[BaileysProvider] Reconnecting ${companyId} in ${current}ms (backoff)`
              );
              setTimeout(() => {
                this.initiateQrCode(companyId, true).catch((err) => {
                  console.error(
                    `[BaileysProvider] Error in backoff reconnect for ${companyId}:`,
                    err
                  );
                });
              }, current);
            } else {
              session.isConnecting = false;
              session.lastError = "Logged out from WhatsApp.";
            }
            return;
          }

          // ---- Never connected: don't reconnect ----
          session.isConnecting = false;
          session.lastError =
            errorMessage || `Disconnected (code: ${statusCode})`;
          console.log(
            `[BaileysProvider] Never-connected disconnect for ${companyId}, NOT reconnecting`
          );
        }
      }
    );
  }

  // ============================================
  // PRIVATE: Setup Message Handler
  // ============================================

  private setupMessageHandler(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket: any,
    companyId: string
  ): void {
    // Handle incoming messages
    socket.ev.on(
      "messages.upsert",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (m: any) => {
        const { messages, type } = m;
        // Only process real-time notifications, not history sync
        if (type !== "notify") return;

        // Process messages concurrently with semaphore limit
        const CONCURRENCY_LIMIT = 5;
        const executing = new Set<Promise<void>>();

        for (const msg of messages as WAMessage[]) {
          const p = this.handleMessage(msg, companyId)
            .catch((err) => {
              console.error(
                `[BaileysProvider] Error handling message for ${companyId}:`,
                err
              );
            })
            .then(() => {
              executing.delete(p);
            });
          executing.add(p);

          if (executing.size >= CONCURRENCY_LIMIT) {
            await Promise.race(executing);
          }
        }

        await Promise.allSettled(executing);
      }
    );

    // Handle LID mapping updates (WhatsApp v7+)
    socket.ev.on(
      "messaging-history.set",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (data: any) => {
        if (data.lidMappings?.length) {
          for (const mapping of data.lidMappings) {
            try {
              const lid = mapping.lid || mapping.lidJid;
              const phone = mapping.phoneNumber || mapping.regularJid;
              if (lid && phone) {
                await this.saveLidMapping(companyId, lid, phone);
              }
            } catch (err) {
              console.error(
                `[BaileysProvider] Error saving LID mapping:`,
                err
              );
            }
          }
        }
      }
    );

    // Capture contacts with LID→phone mappings
    socket.ev.on(
      "contacts.upsert",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (contacts: any[]) => {
        for (const contact of contacts) {
          try {
            const id = contact.id || "";
            const lid = contact.lid || "";
            // If we have both a regular JID and a LID, save the mapping
            if (lid && id && !isLidUser(id)) {
              const phoneDigits = id.replace(/@.*$/, "");
              await this.saveLidMapping(companyId, lid.replace(/@.*$/, ""), phoneDigits);
            }
          } catch {
            // ignore individual contact errors
          }
        }
      }
    );

    // Capture contacts.update for additional LID mappings
    socket.ev.on(
      "contacts.update",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (updates: any[]) => {
        for (const update of updates) {
          try {
            const id = update.id || "";
            const lid = update.lid || "";
            if (lid && id && !isLidUser(id)) {
              const phoneDigits = id.replace(/@.*$/, "");
              await this.saveLidMapping(companyId, lid.replace(/@.*$/, ""), phoneDigits);
            }
          } catch {
            // ignore
          }
        }
      }
    );
  }

  // ============================================
  // PRIVATE: Handle Individual Message
  // ============================================

  private async handleMessage(
    msg: WAMessage,
    companyId: string
  ): Promise<void> {
    // Skip messages without content
    if (!msg.message) return;

    // Skip fromMe messages (outgoing)
    if (msg.key.fromMe) return;

    // Skip status broadcast messages
    if (msg.key.remoteJid === "status@broadcast") return;

    // Skip protocol messages
    const contentType = getContentType(msg.message);
    if (
      contentType === "protocolMessage" ||
      contentType === "senderKeyDistributionMessage"
    ) {
      return;
    }

    const remoteJid = msg.key.remoteJid || "";

    // Skip group messages
    if (remoteJid.endsWith("@g.us")) return;

    // Resolve LID to phone number if needed
    const resolvedJid = await this.resolveLid(companyId, remoteJid);
    // Check if the LID was NOT resolved (resolved still looks like a LID or has 14+ digits)
    const resolvedDigits = resolvedJid.replace(/@.*$/, "").replace(/\D/g, "");
    const unresolvedLid = isLidUser(resolvedJid) || resolvedDigits.length > 13;

    // Determine message type and extract content
    let messageType = "conversation";
    let textContent: string | undefined;
    let mediaMimetype: string | undefined;
    let mediaFileName: string | undefined;

    const message = msg.message;

    if (message.conversation) {
      messageType = "conversation";
      textContent = message.conversation;
    } else if (message.extendedTextMessage) {
      messageType = "extendedTextMessage";
      textContent = message.extendedTextMessage.text || undefined;
    } else if (message.imageMessage) {
      messageType = "imageMessage";
      textContent = message.imageMessage.caption || undefined;
      mediaMimetype = message.imageMessage.mimetype || "image/jpeg";
      mediaFileName = `image_${msg.key.id || Date.now()}.jpg`;
    } else if (message.videoMessage) {
      messageType = "videoMessage";
      textContent = message.videoMessage.caption || undefined;
      mediaMimetype = message.videoMessage.mimetype || "video/mp4";
      mediaFileName = `video_${msg.key.id || Date.now()}.mp4`;
    } else if (message.audioMessage) {
      messageType = "audioMessage";
      mediaMimetype = message.audioMessage.mimetype || "audio/ogg";
      mediaFileName = `audio_${msg.key.id || Date.now()}.ogg`;
    } else if (message.documentMessage) {
      messageType = "documentMessage";
      textContent =
        message.documentMessage.caption ||
        message.documentMessage.title ||
        undefined;
      mediaMimetype =
        message.documentMessage.mimetype || "application/octet-stream";
      mediaFileName =
        message.documentMessage.fileName ||
        message.documentMessage.title ||
        `document_${msg.key.id || Date.now()}`;
    } else {
      // Unknown message type, skip
      return;
    }

    const hasMedia = !!mediaFileName;
    const externalId = msg.key.id || "";

    // Build webhook payload compatible with EvolutionWebhookPayload
    // Dispatch text/event immediately WITHOUT waiting for media download
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webhookPayload: Record<string, any> = {
      event: "messages.upsert",
      instance: companyId,
      externalId,
      companyId,
      data: {
        key: {
          remoteJid: resolvedJid,
          fromMe: false,
          id: externalId,
        },
        pushName: msg.pushName || "",
        message: this.buildMessageField(message, messageType),
        messageType,
        messageTimestamp:
          typeof msg.messageTimestamp === "number"
            ? msg.messageTimestamp
            : Number(msg.messageTimestamp || 0),
        // Flag if LID could not be resolved to real phone number
        ...(unresolvedLid && {
          unresolvedLid: true,
          originalJid: remoteJid,
        }),
        // Include media metadata (without URL) so ERP knows media is coming
        ...(hasMedia && {
          mediaPending: true,
          mediaMimetype: mediaMimetype,
          mediaFileName: mediaFileName,
        }),
      },
    };

    await this.dispatchWebhook(webhookPayload);

    console.log(
      `[BaileysProvider] Incoming message for ${companyId}: type=${messageType}, from=${resolvedJid}${unresolvedLid ? " (UNRESOLVED LID)" : ""}`
    );

    // Download media asynchronously — don't block message processing
    if (hasMedia) {
      this.downloadAndDispatchMedia(msg, companyId, externalId, mediaMimetype!, mediaFileName!)
        .catch((err) => {
          console.error(
            `[BaileysProvider] Async media download failed for ${externalId}:`,
            err
          );
        });
    }
  }

  /**
   * Download media from WhatsApp and dispatch a follow-up webhook with the local URL.
   * Runs asynchronously after the initial message webhook.
   */
  private async downloadAndDispatchMedia(
    msg: WAMessage,
    companyId: string,
    externalId: string,
    mimetype: string,
    fileName: string
  ): Promise<void> {
    const mediaLocalUrl = await this.downloadAndSaveMedia(msg, companyId, fileName);
    if (!mediaLocalUrl) return;

    await this.dispatchWebhook({
      event: "message.media",
      instance: companyId,
      externalId,
      companyId,
      data: {
        externalId,
        media: {
          url: mediaLocalUrl,
          mimetype,
          fileName,
        },
      },
    });
  }

  // ============================================
  // PRIVATE: Build Message Field for Webhook
  // ============================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildMessageField(message: any, messageType: string): any {
    // Build a simplified message object matching EvolutionWebhookPayload format
    switch (messageType) {
      case "conversation":
        return { conversation: message.conversation };
      case "extendedTextMessage":
        return {
          extendedTextMessage: { text: message.extendedTextMessage?.text },
        };
      case "imageMessage":
        return {
          imageMessage: {
            mimetype: message.imageMessage?.mimetype,
            caption: message.imageMessage?.caption,
            fileLength: String(message.imageMessage?.fileLength || "0"),
            fileName: message.imageMessage?.fileName,
          },
        };
      case "videoMessage":
        return {
          videoMessage: {
            mimetype: message.videoMessage?.mimetype,
            caption: message.videoMessage?.caption,
            fileLength: String(message.videoMessage?.fileLength || "0"),
            fileName: message.videoMessage?.fileName,
          },
        };
      case "audioMessage":
        return {
          audioMessage: {
            mimetype: message.audioMessage?.mimetype,
            fileLength: String(message.audioMessage?.fileLength || "0"),
          },
        };
      case "documentMessage":
        return {
          documentMessage: {
            mimetype: message.documentMessage?.mimetype,
            caption: message.documentMessage?.caption,
            fileLength: String(message.documentMessage?.fileLength || "0"),
            fileName: message.documentMessage?.fileName,
            title: message.documentMessage?.title,
          },
        };
      default:
        return {};
    }
  }

  // ============================================
  // PRIVATE: Download and Save Media
  // ============================================

  private async downloadAndSaveMedia(
    msg: WAMessage,
    companyId: string,
    fileName: string
  ): Promise<string | undefined> {
    try {
      const buffer = await downloadMediaMessage(
        msg,
        "buffer",
        {},
        {
          logger: undefined as never,
          reuploadRequest: async () => {
            throw new Error("Reupload not implemented");
          },
        }
      );

      if (!buffer || (buffer as Buffer).length === 0) {
        console.warn(
          `[BaileysProvider] Empty media buffer for ${companyId}`
        );
        return undefined;
      }

      // Save to uploads/{companyId}/
      const uploadsDir = path.join(process.cwd(), "uploads", companyId);
      await fs.mkdir(uploadsDir, { recursive: true });

      const safeName = fileName
        .replace(/[^a-zA-Z0-9_.-]/g, "_")
        .substring(0, 100);
      const fullName = `${Date.now()}_${safeName}`;
      const fullPath = path.join(uploadsDir, fullName);

      await fs.writeFile(fullPath, buffer as Buffer);

      // Return URL accessible via Express static serving
      const publicUrl = `${SERVICE_BASE_URL}/uploads/${companyId}/${fullName}`;

      console.log(
        `[BaileysProvider] Media saved for ${companyId}: ${fullPath}`
      );
      return publicUrl;
    } catch (err) {
      console.error(
        `[BaileysProvider] Error downloading media for ${companyId}:`,
        err
      );
      return undefined;
    }
  }

  // ============================================
  // PRIVATE: Dispatch Webhook to ERP
  // ============================================

  private async dispatchWebhook(
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!WEBHOOK_URL) {
      console.warn("[BaileysProvider] No WEBHOOK_URL configured, skipping webhook");
      return;
    }

    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 10_000;
    const idempotencyKey = payload.externalId
      ? `${payload.companyId}:${payload.externalId}`
      : undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: WEBHOOK_SECRET,
            ...(idempotencyKey
              ? { "X-Idempotency-Key": idempotencyKey }
              : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) return;

        console.error(
          `[BaileysProvider] Webhook attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${response.status}`
        );
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        console.error(
          `[BaileysProvider] Webhook attempt ${attempt + 1}/${MAX_RETRIES + 1} ${isTimeout ? "timed out" : "error"}:`,
          isTimeout ? "" : err
        );
      }

      if (attempt < MAX_RETRIES) {
        const backoffMs =
          Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 1000;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    // All retries exhausted — log as DLQ (dead letter)
    console.error(
      `[BaileysProvider] DLQ: webhook failed after ${MAX_RETRIES + 1} attempts`,
      JSON.stringify({
        event: payload.event,
        externalId: payload.externalId,
        companyId: payload.companyId,
      })
    );
  }

  // ============================================
  // PRIVATE: Normalize JID
  // ============================================

  private normalizeJid(to: string): string {
    // If already a JID, return as-is
    if (to.includes("@")) return to;

    // Strip non-digits
    const digits = to.replace(/\D/g, "");

    return `${digits}@s.whatsapp.net`;
  }

  // ============================================
  // PRIVATE: Resolve LID to Phone Number
  // ============================================

  // In-memory cache for LID→phone resolution (stable mappings, rarely change)
  private lidCache = new Map<
    string,
    { phone: string; timestamp: number }
  >();
  private static readonly LID_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  private async resolveLid(
    companyId: string,
    jid: string
  ): Promise<string> {
    const userPart = jid.replace(/@.*$/, "");
    const digits = userPart.replace(/\D/g, "");

    // Detect LIDs: explicit @lid domain, colon in user part, or suspiciously long number (14+ digits)
    const looksLikeLid =
      isLidUser(jid) ||
      userPart.includes(":") ||
      (digits.length > 13 && !jid.includes("@g.us"));

    if (!looksLikeLid) {
      return jid;
    }

    // Check in-memory cache first
    const cacheKey = `${companyId}:${userPart}`;
    const cached = this.lidCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.timestamp < BaileysProvider.LID_CACHE_TTL
    ) {
      return `${cached.phone}@s.whatsapp.net`;
    }

    // Try to resolve the LID to a real phone number
    // Search by exact LID and also by digits (some LIDs are stored without colons)
    try {
      const mapping = await prisma.lidMapping.findFirst({
        where: {
          companyId,
          OR: [{ lid: userPart }, { lid: digits }],
        },
      });

      if (mapping) {
        console.log(
          `[BaileysProvider] Resolved LID ${userPart} -> ${mapping.phoneNumber}`
        );
        this.lidCache.set(cacheKey, {
          phone: mapping.phoneNumber,
          timestamp: Date.now(),
        });
        return `${mapping.phoneNumber}@s.whatsapp.net`;
      }
    } catch (err) {
      console.error(`[BaileysProvider] Error resolving LID ${userPart}:`, err);
    }

    // If no mapping found, return original JID
    console.warn(
      `[BaileysProvider] No LID mapping found for ${userPart} (company ${companyId})`
    );
    return jid;
  }

  // ============================================
  // PRIVATE: Save LID Mapping
  // ============================================

  private async saveLidMapping(
    companyId: string,
    lid: string,
    phoneNumber: string
  ): Promise<void> {
    const cleanLid = lid.replace(/@.*$/, "");
    const cleanPhone = phoneNumber.replace(/@.*$/, "");

    try {
      await prisma.lidMapping.upsert({
        where: {
          companyId_lid: { companyId, lid: cleanLid },
        },
        update: { phoneNumber: cleanPhone },
        create: { companyId, lid: cleanLid, phoneNumber: cleanPhone },
      });
      // Invalidate LID cache for this mapping
      this.lidCache.set(`${companyId}:${cleanLid}`, {
        phone: cleanPhone,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(
        `[BaileysProvider] Error saving LID mapping ${cleanLid} -> ${cleanPhone}:`,
        err
      );
    }
  }

  // ============================================
  // PRIVATE: Clear Auth State (credentials only — preserves LID mappings)
  // Use for: manual disconnect, reconnect flows, QR/pairing initiation.
  // ============================================

  private async clearAuthState(companyId: string): Promise<void> {
    try {
      await prisma.baileysAuthState.deleteMany({
        where: { companyId },
      });
    } catch (err) {
      console.error(
        `[BaileysProvider] Error clearing auth state for ${companyId}:`,
        err
      );
    }
  }

  // ============================================
  // PRIVATE: Clear Auth State + LID Mappings (full wipe)
  // Use ONLY for: loggedOut / device_removed events.
  // LID mappings are stable per device — wiping them on a simple disconnect
  // forces expensive re-resolution of all incoming messages after reconnect.
  // ============================================

  private async clearAuthStateFull(companyId: string): Promise<void> {
    try {
      await prisma.baileysAuthState.deleteMany({
        where: { companyId },
      });
      await prisma.lidMapping.deleteMany({
        where: { companyId },
      });
    } catch (err) {
      console.error(
        `[BaileysProvider] Error clearing full auth state for ${companyId}:`,
        err
      );
    }
  }
}

// ============================================
// Singleton export
// ============================================

export const baileysProvider = new BaileysProvider();
