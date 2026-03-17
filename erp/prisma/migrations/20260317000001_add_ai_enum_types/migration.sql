-- Migration: Add AiProvider and AiChannel enum types
-- Enforces DB-level constraint on ai_config.provider and ai_usage_logs.channel
-- Addresses WARN-1 from QA review (PR #71)

-- Create enum types
CREATE TYPE "AiProvider" AS ENUM ('openai', 'anthropic', 'deepseek', 'grok', 'qwen');
CREATE TYPE "AiChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- Migrate ai_config.provider from TEXT to AiProvider enum
ALTER TABLE "ai_config"
  ALTER COLUMN "provider" TYPE "AiProvider"
    USING "provider"::"AiProvider",
  ALTER COLUMN "provider" SET DEFAULT 'openai'::"AiProvider";

-- Migrate ai_usage_logs.channel from TEXT to AiChannel enum
ALTER TABLE "ai_usage_logs"
  ALTER COLUMN "channel" TYPE "AiChannel"
    USING "channel"::"AiChannel";

-- Migrate ai_usage_logs.provider from TEXT to AiProvider enum
ALTER TABLE "ai_usage_logs"
  ALTER COLUMN "provider" TYPE "AiProvider"
    USING "provider"::"AiProvider";
