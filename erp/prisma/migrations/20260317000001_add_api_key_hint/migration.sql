-- AlterTable: add apiKeyHint column to ai_config
-- Stores the last 4 chars of the plaintext API key for masked display
-- Eliminates the need to decrypt the encrypted key just for UI display
ALTER TABLE "ai_config" ADD COLUMN "apiKeyHint" TEXT;
