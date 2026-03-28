-- CreateTable
CREATE TABLE "ai_audit_trails" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "messageId" TEXT,
    "responseMessageId" TEXT,
    "companyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL,
    "input" TEXT NOT NULL,
    "reasoning" TEXT,
    "toolCalls" JSONB NOT NULL DEFAULT '[]',
    "output" TEXT,
    "decision" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costBrl" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_audit_trails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_audit_trails_ticketId_createdAt_idx" ON "ai_audit_trails"("ticketId", "createdAt");
CREATE INDEX "ai_audit_trails_companyId_createdAt_idx" ON "ai_audit_trails"("companyId", "createdAt");
CREATE INDEX "ai_audit_trails_messageId_idx" ON "ai_audit_trails"("messageId");
CREATE INDEX "ai_audit_trails_isArchived_createdAt_idx" ON "ai_audit_trails"("isArchived", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_audit_trails" ADD CONSTRAINT "ai_audit_trails_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_audit_trails" ADD CONSTRAINT "ai_audit_trails_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ticket_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_audit_trails" ADD CONSTRAINT "ai_audit_trails_responseMessageId_fkey" FOREIGN KEY ("responseMessageId") REFERENCES "ticket_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_audit_trails" ADD CONSTRAINT "ai_audit_trails_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: audit trail config in AiConfig
ALTER TABLE "ai_config" ADD COLUMN "auditTrailEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ai_config" ADD COLUMN "auditRetentionDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "ai_config" ADD COLUMN "auditReasoningEnabled" BOOLEAN NOT NULL DEFAULT true;
