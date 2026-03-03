import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma.js";
import { useDatabaseAuthState } from "./useDatabaseAuthState.js";

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
            // Clear auth state so next connection starts fresh
            await this.clearAuthState(companyId);
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
  // PRIVATE: Clear Auth State
  // ============================================

  private async clearAuthState(companyId: string): Promise<void> {
    try {
      await prisma.baileysAuthState.deleteMany({
        where: { companyId },
      });
      await prisma.lidMapping.deleteMany({
        where: { companyId },
      });
    } catch (err) {
      console.error(
        `[BaileysProvider] Error clearing auth state for ${companyId}:`,
        err
      );
    }
  }
}

// ============================================
// Singleton export
// ============================================

export const baileysProvider = new BaileysProvider();
