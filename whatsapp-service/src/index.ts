import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { prisma } from "./lib/prisma.js";
import { baileysProvider } from "./providers/baileys.provider.js";

const app = express();
const PORT = parseInt(process.env.WHATSAPP_SERVICE_PORT || "3001", 10);
const API_KEY = process.env.WHATSAPP_SERVICE_API_KEY || "";

// ============================================
// Startup config validation
// ============================================

if (!API_KEY) {
  console.error(
    "[FATAL] WHATSAPP_SERVICE_API_KEY não está definida. " +
      "O serviço não pode subir sem uma chave de API. " +
      "Defina a variável de ambiente e reinicie."
  );
  process.exit(1);
}

const WEBHOOK_URL_LOG = process.env.WHATSAPP_WEBHOOK_URL || "(não definida)";
const SERVICE_BASE_URL_LOG =
  process.env.WHATSAPP_SERVICE_BASE_URL || `http://localhost:${PORT}`;
const maskedKey =
  API_KEY.length > 8
    ? `${API_KEY.slice(0, 4)}${"*".repeat(API_KEY.length - 8)}${API_KEY.slice(-4)}`
    : "****";

console.log("[Config] WhatsApp Service iniciando com:");
console.log(`  PORT             = ${PORT}`);
console.log(`  API_KEY          = ${maskedKey}`);
console.log(`  WEBHOOK_URL      = ${WEBHOOK_URL_LOG}`);
console.log(`  SERVICE_BASE_URL = ${SERVICE_BASE_URL_LOG}`);

// ============================================
// Middleware
// ============================================

// WHATSAPP_CORS_ORIGIN: allowed CORS origin (default "*" for dev).
// In production, set to the specific origin of your ERP frontend/backend,
// e.g. "https://erp.mendes.app" to block unauthorized cross-origin requests.
const CORS_ORIGIN = process.env.WHATSAPP_CORS_ORIGIN || "*";
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Serve uploaded media files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ============================================
// Health check (no auth)
// ============================================

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ============================================
// API Key Auth Middleware
// ============================================

function apiKeyAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const key = req.headers["apikey"] as string | undefined;
  if (!API_KEY || key !== API_KEY) {
    res.status(401).json({ error: "Unauthorized: invalid or missing apikey" });
    return;
  }
  next();
}

// Apply auth to all routes below
app.use(apiKeyAuth);

// ============================================
// Instance Routes
// ============================================

// POST /instance/connect — Initiate QR code connection
app.post("/instance/connect", async (req, res) => {
  try {
    const { companyId } = req.body;
    if (!companyId) {
      res.status(400).json({ error: "companyId is required" });
      return;
    }

    await baileysProvider.initiateQrCode(companyId);

    // Try to get the QR code immediately (wait up to 10s)
    const qrCode = await baileysProvider.getQrCode(companyId);
    const status = baileysProvider.getConnectionStatus(companyId);

    res.json({
      status: status.isConnected
        ? "connected"
        : status.isConnecting
          ? "connecting"
          : "disconnected",
      qrCode: qrCode || undefined,
    });
  } catch (err) {
    console.error("[API] Error in POST /instance/connect:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /instance/connect-pairing — Initiate pairing code connection
app.post("/instance/connect-pairing", async (req, res) => {
  try {
    const { companyId, phoneNumber } = req.body;
    if (!companyId || !phoneNumber) {
      res
        .status(400)
        .json({ error: "companyId and phoneNumber are required" });
      return;
    }

    await baileysProvider.initiatePairingCode(companyId, phoneNumber);

    // Wait for pairing code
    const pairingCode = await baileysProvider.getPairingCode(companyId);

    res.json({
      pairingCode: pairingCode || undefined,
    });
  } catch (err) {
    console.error("[API] Error in POST /instance/connect-pairing:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// GET /instance/:companyId/qr — Get QR code
app.get("/instance/:companyId/qr", async (req, res) => {
  try {
    const { companyId } = req.params;
    const qrCode = await baileysProvider.getQrCode(companyId);

    if (!qrCode) {
      res.status(404).json({ error: "QR code not available" });
      return;
    }

    res.json({ qrCode });
  } catch (err) {
    console.error("[API] Error in GET /instance/:companyId/qr:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// GET /instance/:companyId/pairing-code — Get pairing code
app.get("/instance/:companyId/pairing-code", async (req, res) => {
  try {
    const { companyId } = req.params;
    const pairingCode = await baileysProvider.getPairingCode(companyId);

    if (!pairingCode) {
      res.status(404).json({ error: "Pairing code not available" });
      return;
    }

    res.json({ pairingCode });
  } catch (err) {
    console.error(
      "[API] Error in GET /instance/:companyId/pairing-code:",
      err
    );
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// GET /instance/:companyId/status — Get connection status
app.get("/instance/:companyId/status", (req, res) => {
  const { companyId } = req.params;
  const status = baileysProvider.getConnectionStatus(companyId);
  res.json(status);
});

// POST /instance/:companyId/disconnect — Disconnect session
app.post("/instance/:companyId/disconnect", async (req, res) => {
  try {
    const { companyId } = req.params;
    await baileysProvider.disconnect(companyId);
    res.json({ status: "disconnected" });
  } catch (err) {
    console.error(
      "[API] Error in POST /instance/:companyId/disconnect:",
      err
    );
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// ============================================
// Message Routes
// ============================================

const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Limit: 30 requests per minute per IP.",
  },
});

// POST /message/send-text — Send text message
app.post("/message/send-text", messageSendLimiter, async (req, res) => {
  try {
    const { companyId, to, content } = req.body;
    if (!companyId || !to || !content) {
      res
        .status(400)
        .json({ error: "companyId, to, and content are required" });
      return;
    }

    const messageId = await baileysProvider.sendMessage(companyId, to, content);
    res.json({ messageId });
  } catch (err) {
    console.error("[API] Error in POST /message/send-text:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// POST /message/send-media — Send media message
app.post("/message/send-media", messageSendLimiter, async (req, res) => {
  try {
    const { companyId, to, mediaUrl, caption, mediaType } = req.body;
    if (!companyId || !to || !mediaUrl) {
      res
        .status(400)
        .json({ error: "companyId, to, and mediaUrl are required" });
      return;
    }

    const messageId = await baileysProvider.sendMediaMessage(
      companyId,
      to,
      mediaUrl,
      caption,
      mediaType || "image"
    );
    res.json({ messageId });
  } catch (err) {
    console.error("[API] Error in POST /message/send-media:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

// ============================================
// Start Server
// ============================================

const server = app.listen(PORT, () => {
  console.log(`WhatsApp Service running on port ${PORT}`);
});

// ============================================
// Auto-reconnect sessions saved in DB
// ============================================

(async () => {
  try {
    const rows = await prisma.$queryRaw<{ companyId: string }[]>`
      SELECT DISTINCT "companyId" FROM "baileysAuthState"
    `;
    if (rows.length === 0) {
      console.log("[Startup] No saved sessions found, skipping auto-reconnect");
      return;
    }
    console.log(
      `[Startup] Auto-reconnecting ${rows.length} company session(s)...`
    );
    for (const { companyId } of rows) {
      console.log(`[Startup] Scheduling reconnect for company: ${companyId}`);
      baileysProvider.initiateQrCode(companyId, true).catch((err) => {
        console.error(`[Startup] Failed to reconnect ${companyId}:`, err);
      });
    }
  } catch (err) {
    console.error(
      "[Startup] Error loading saved sessions for auto-reconnect:",
      err
    );
  }
})();

// ============================================
// Graceful Shutdown
// ============================================

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[${signal}] Shutting down WhatsApp Service...`);
  server.close(() => {
    console.log("HTTP server closed");
  });
  await prisma.$disconnect();
  console.log("Prisma disconnected");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
