import crypto from "crypto";

const ALGORITHM = "aes-128-cbc";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY não configurada");
  return Buffer.from(key, "hex");
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const SENSITIVE_FIELDS = ["password", "apiKey"];

export function encryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result = { ...config };
  for (const field of SENSITIVE_FIELDS) {
    if (typeof result[field] === "string" && result[field]) {
      result[field] = encrypt(result[field] as string);
    }
  }
  return result;
}

export function decryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result = { ...config };
  for (const field of SENSITIVE_FIELDS) {
    if (typeof result[field] === "string" && result[field]) {
      try {
        result[field] = decrypt(result[field] as string);
      } catch {
        // If decryption fails, field may not be encrypted yet
      }
    }
  }
  return result;
}
