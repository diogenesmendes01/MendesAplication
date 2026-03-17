-- Migration: add apiKeyHint column to ai_config
-- Last 4 chars of plaintext API key stored for user-friendly display
-- without decryption. See: https://github.com/diogenesmendes01/MendesAplication/issues/107
ALTER TABLE "ai_config" ADD COLUMN "apiKeyHint" TEXT;
