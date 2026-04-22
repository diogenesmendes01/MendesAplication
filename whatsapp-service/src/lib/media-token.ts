import crypto from "crypto";

const MEDIA_TOKEN_SECRET =
  process.env.WHATSAPP_MEDIA_TOKEN_SECRET || process.env.WHATSAPP_SERVICE_API_KEY || "";

function getSecret(): string {
  if (!MEDIA_TOKEN_SECRET) {
    throw new Error(
      "WHATSAPP_MEDIA_TOKEN_SECRET ou WHATSAPP_SERVICE_API_KEY deve estar definida para proteger os uploads."
    );
  }
  return MEDIA_TOKEN_SECRET;
}

function createSignature(relativePath: string, expires: number): string {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${normalizedPath}:${expires}`)
    .digest("hex");
}

export function buildSignedMediaUrl(
  companyId: string,
  fileName: string,
  baseUrl: string,
  ttlSeconds = 10 * 60
): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = createSignature(`${companyId}/${fileName}`, expires);
  const encodedFile = encodeURIComponent(fileName);
  return `${baseUrl}/media/${companyId}/${encodedFile}?expires=${expires}&signature=${signature}`;
}

export function verifySignedMediaRequest(
  companyId: string,
  fileName: string,
  expiresParam: string | string[] | undefined,
  signatureParam: string | string[] | undefined
): boolean {
  if (Array.isArray(expiresParam) || Array.isArray(signatureParam)) {
    return false;
  }
  if (!expiresParam || !signatureParam) return false;
  const expires = Number(expiresParam);
  if (!Number.isFinite(expires)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (expires < now) return false;

  const expected = createSignature(`${companyId}/${fileName}`, expires);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(signatureParam, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
