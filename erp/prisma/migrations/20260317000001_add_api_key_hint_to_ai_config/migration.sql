-- Issue-107: Add apiKeyHint column to ai_config
-- Stores last 4 chars of plaintext API key for masked display,
-- eliminating the need to decrypt on every read.
ALTER TABLE "ai_config" ADD COLUMN "apiKeyHint" TEXT;
