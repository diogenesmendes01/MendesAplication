-- AlterTable: add apiKeyHint column to ai_config
-- Stores the last 4 characters of the plaintext API key for admin display
-- without requiring decryption of the stored ciphertext.
ALTER TABLE "ai_config" ADD COLUMN "apiKeyHint" TEXT;
