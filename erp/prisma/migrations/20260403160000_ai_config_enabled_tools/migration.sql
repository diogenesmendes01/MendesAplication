-- DEFAULT empty array = all tools enabled (backward-compatible).
-- Existing configs will have unrestricted tool access until explicitly configured.
-- See: feat/ai-config-enabled-tools — getToolsForChannel() returns full set when array is empty.
-- AlterTable
ALTER TABLE "AiConfig" ADD COLUMN "whatsappEnabledTools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AiConfig" ADD COLUMN "emailEnabledTools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AiConfig" ADD COLUMN "raEnabledTools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
