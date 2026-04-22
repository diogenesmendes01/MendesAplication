import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  // 16 bytes hex = 32 hex chars for v1 compatibility
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
});

describe("encryption utilities", () => {
  it("should encrypt and decrypt text (v2 roundtrip)", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");
    const plaintext = "Dados sensíveis do ERP";

    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith("v2:")).toBe(true);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertexts for same input (random IV)", async () => {
    const { encrypt } = await import("@/lib/encryption");
    const plaintext = "test data";

    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);

    expect(enc1).not.toBe(enc2);
  });

  it("should handle empty strings", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");

    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("should handle unicode and special characters", async () => {
    const { encrypt, decrypt } = await import("@/lib/encryption");
    const text = "São Paulo — R$ 1.234,56 • Ñoño 🇧🇷";

    const decrypted = decrypt(encrypt(text));
    expect(decrypted).toBe(text);
  });
});
