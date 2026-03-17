-- US-007: Add apiKeyHint column to ai_config
-- Stores the last 4 characters of the plaintext API key for display purposes,
-- eliminating the need to decrypt the full ciphertext just to show a masked hint.
-- Invariant: apiKeyHint is only valid (non-null) when apiKey is also non-null.
ALTER TABLE "ai_config" ADD COLUMN "apiKeyHint" TEXT;
