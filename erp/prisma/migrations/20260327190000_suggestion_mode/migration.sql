-- Suggestion Mode: New fields on AiConfig + AiSuggestion model
-- This migration adds the operation mode system (auto/suggest/hybrid)

-- ─── CreateEnum: AiSuggestionStatus ──────────────────────────────────────────
CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EDITED', 'EXPIRED');

-- ─── AlterTable: ai_config ───────────────────────────────────────────────────
ALTER TABLE "ai_config" ADD COLUMN "operationMode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "ai_config" ADD COLUMN "hybridThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8;
ALTER TABLE "ai_config" ADD COLUMN "alwaysRequireApproval" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ai_config" ADD COLUMN "suggestionTimeoutMin" INTEGER NOT NULL DEFAULT 60;

-- ─── Migrate raMode to operationMode ─────────────────────────────────────────
-- Companies with raMode = 'suggest' → operationMode = 'suggest'
-- Companies with raMode = 'auto' → operationMode = 'auto' (already default)
-- Companies with raMode = 'off' → keep operationMode = 'auto' (raMode='off' still respected)
UPDATE "ai_config"
SET "operationMode" = 'suggest'
WHERE "raMode" = 'suggest';

-- ─── CreateTable: ai_suggestions ─────────────────────────────────────────────
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "messageId" TEXT,
    "companyId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "analysis" JSONB NOT NULL,
    "suggestedResponse" TEXT NOT NULL,
    "suggestedSubject" TEXT,
    "suggestedActions" JSONB NOT NULL,
    "raPrivateMessage" TEXT,
    "raPublicMessage" TEXT,
    "raDetectedType" TEXT,
    "raSuggestModeration" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "editedResponse" TEXT,
    "editedSubject" TEXT,
    "rejectionReason" TEXT,
    "executionResult" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX "ai_suggestions_ticketId_status_idx" ON "ai_suggestions"("ticketId", "status");
CREATE INDEX "ai_suggestions_companyId_status_createdAt_idx" ON "ai_suggestions"("companyId", "status", "createdAt");
CREATE INDEX "ai_suggestions_status_expiresAt_idx" ON "ai_suggestions"("status", "expiresAt");
CREATE INDEX "ai_suggestions_reviewedBy_idx" ON "ai_suggestions"("reviewedBy");

-- ─── Foreign Keys ────────────────────────────────────────────────────────────
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ticket_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Add PROCESSING status to AiSuggestionStatus enum ────────────────────────
ALTER TYPE "AiSuggestionStatus" ADD VALUE 'PROCESSING';
