-- Issue #107: Add apiKeyHint to AiConfig for user-friendly key display
-- Stores the last 4 chars of the plaintext API key (set on save).
-- Nullable so existing rows remain valid without re-saving.
ALTER TABLE "ai_config" ADD COLUMN "apiKeyHint" TEXT;
