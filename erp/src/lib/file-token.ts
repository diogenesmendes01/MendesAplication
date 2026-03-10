import crypto from "crypto";

// Fallback to WHATSAPP_SERVICE_API_KEY to avoid introducing another secret for now.
const TOKEN_SECRET =
  process.env.FILE_TOKEN_SECRET || process.env.WHATSAPP_SERVICE_API_KEY || "";

function getSecret(): string {
  if (!TOKEN_SECRET) {
    throw new Error(
      "FILE_TOKEN_SECRET ou WHATSAPP_SERVICE_API_KEY deve estar configurado para gerar links assinados."
    );
  }
  return TOKEN_SECRET;
}

function createSignature(storagePath: string, expires: number): string {
  const normalizedPath = storagePath.replace(/\\/g, "/");
  const payload = `${normalizedPath}:${expires}`;
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function generateSignedFileUrl(
  storagePath: string,
  options?: { ttlSeconds?: number; baseUrl?: string }
): string {
  const ttlSeconds = options?.ttlSeconds ?? 10 * 60;
  const baseUrl =
    options?.baseUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = createSignature(storagePath, expires);

  const normalizedPath = storagePath.replace(/\\/g, "/");
  return `${baseUrl}/api/files/m2m/${normalizedPath}?expires=${expires}&signature=${signature}`;
}

export function verifySignedFileRequest(
  storagePath: string,
  expiresParam: string | null,
  signature: string | null
): boolean {
  if (!expiresParam || !signature) return false;
  const expires = Number(expiresParam);
  if (!Number.isFinite(expires)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (expires < now) return false;

  const expected = createSignature(storagePath, expires);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(signature, "hex");

  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
