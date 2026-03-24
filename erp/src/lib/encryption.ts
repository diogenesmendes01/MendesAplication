import crypto from "crypto";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * v1 (legado): AES-128-CBC sem autenticação de integridade.
 *   Formato: "<ivHex>:<ciphertextHex>"
 *   Problema: CBC não autentica — atacante pode alterar ciphertext sem detecção.
 *
 * v2 (atual): AES-256-GCM com autenticação de integridade (AEAD).
 *   Formato: "v2:<ivHex>:<authTagHex>:<ciphertextHex>"
 *   Benefícios:
 *     - Chave de 256 bits (mais forte que 128)
 *     - Tag de autenticação de 16 bytes — detecta qualquer modificação no ciphertext
 *     - IV de 12 bytes (recomendado para GCM)
 */
const ENCRYPTION_VERSION = "v2";

// Parâmetros v2 (AES-256-GCM)
const ALGO_V2 = "aes-256-gcm";
const IV_LENGTH_V2 = 12; // bytes — recomendado para GCM (96 bits)
const AUTH_TAG_LENGTH = 16; // bytes

// Parâmetros v1 (AES-128-CBC) — mantidos apenas para descriptografia retroativa
const ALGO_V1 = "aes-128-cbc";
// IV_LENGTH_V1 = 16 — removido (v1 descontinuada)

// ---------------------------------------------------------------------------
// Chaves
// ---------------------------------------------------------------------------

/**
 * Retorna a chave para AES-128-CBC (v1 legado) — 16 bytes.
 * A variável ENCRYPTION_KEY deve ser 32 hex chars (= 16 bytes).
 */
function getKeyV1(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY não configurada");
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 16) {
    throw new Error("ENCRYPTION_KEY deve ter 32 caracteres hexadecimais (16 bytes) para v1");
  }
  return buf;
}

/**
 * Deriva a chave para AES-256-GCM (v2) — 32 bytes.
 * Usa SHA-256 sobre a ENCRYPTION_KEY existente para derivar 32 bytes sem
 * exigir uma nova variável de ambiente, mantendo retrocompatibilidade.
 *
 * Se ENCRYPTION_KEY_V2 estiver definida (64 hex chars), ela é usada diretamente.
 * Isso permite rotação de chave sem depender da v1.
 */
function getKeyV2(): Buffer {
  // Preferir chave dedicada v2 se disponível
  const keyV2 = process.env.ENCRYPTION_KEY_V2;
  if (keyV2) {
    const buf = Buffer.from(keyV2, "hex");
    if (buf.length !== 32) {
      throw new Error("ENCRYPTION_KEY_V2 deve ter 64 caracteres hexadecimais (32 bytes)");
    }
    return buf;
  }

  // Derivar 32 bytes a partir da ENCRYPTION_KEY v1 via SHA-256
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY não configurada");
  return crypto.createHash("sha256").update(Buffer.from(key, "hex")).digest();
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Cifra texto usando AES-256-GCM (v2).
 * Retorna string no formato: "v2:<ivHex>:<authTagHex>:<ciphertextHex>"
 */
export function encrypt(text: string): string {
  const key = getKeyV2();
  const iv = crypto.randomBytes(IV_LENGTH_V2);

  const cipher = crypto.createCipheriv(ALGO_V2, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_VERSION}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decifra texto.
 * Detecta automaticamente o formato (v1 legado ou v2) pelo prefixo.
 *
 * v2: "v2:<ivHex>:<authTagHex>:<ciphertextHex>" — AES-256-GCM (autenticado)
 * v1: "<ivHex>:<ciphertextHex>"                  — AES-128-CBC (legado)
 */
export function decrypt(encryptedText: string): string {
  if (encryptedText.startsWith("v2:")) {
    return decryptV2(encryptedText);
  }
  return decryptV1Legacy(encryptedText);
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

function decryptV2(encryptedText: string): string {
  const parts = encryptedText.split(":");
  // formato: v2 : ivHex : authTagHex : ciphertextHex
  if (parts.length !== 4) {
    throw new Error("Formato de ciphertext v2 inválido");
  }

  const [, ivHex, authTagHex, ciphertextHex] = parts;
  const key = getKeyV2();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGO_V2, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** Descriptografia retroativa para dados cifrados com AES-128-CBC (v1). */
function decryptV1Legacy(encryptedText: string): string {
  const key = getKeyV1();
  const [ivHex, ciphertextHex] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");

  const decipher = crypto.createDecipheriv(ALGO_V1, key, iv);
  let decrypted = decipher.update(ciphertextHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ---------------------------------------------------------------------------
// Helpers para configurações sensíveis
// ---------------------------------------------------------------------------

const SENSITIVE_FIELDS = ["password", "apiKey", "clientSecret"];

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
        // Campo pode não estar criptografado ainda — manter como está
      }
    }
  }
  return result;
}
