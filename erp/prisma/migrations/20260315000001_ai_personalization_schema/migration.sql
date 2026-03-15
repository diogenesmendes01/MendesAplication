-- US-001: AI Personalization — new AiConfig fields + AiUsageLog table

-- Add new columns to ai_config
ALTER TABLE "ai_config" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE "ai_config" ADD COLUMN "apiKey" TEXT;
ALTER TABLE "ai_config" ADD COLUMN "model" TEXT;
ALTER TABLE "ai_config" ADD COLUMN "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ai_config" ADD COLUMN "emailEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_config" ADD COLUMN "emailPersona" TEXT;
ALTER TABLE "ai_config" ADD COLUMN "emailSignature" TEXT;
ALTER TABLE "ai_config" ADD COLUMN "dailySpendLimitBrl" DECIMAL(10,2);
ALTER TABLE "ai_config" ADD COLUMN "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7;

-- Create ai_usage_logs table
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "aiConfigId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "costBrl" DECIMAL(10,4) NOT NULL,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- Create indexes on ai_usage_logs
CREATE INDEX "ai_usage_logs_companyId_createdAt_idx" ON "ai_usage_logs"("companyId", "createdAt");
CREATE INDEX "ai_usage_logs_aiConfigId_createdAt_idx" ON "ai_usage_logs"("aiConfigId", "createdAt");

-- Add foreign key from ai_usage_logs to ai_config
ALTER TABLE "ai_usage_logs"
  ADD CONSTRAINT "ai_usage_logs_aiConfigId_fkey"
  FOREIGN KEY ("aiConfigId") REFERENCES "ai_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
