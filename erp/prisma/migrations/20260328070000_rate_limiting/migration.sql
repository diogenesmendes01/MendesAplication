-- Rate Limiting per Ticket
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "maxAiInteractionsPerTicketPerHour" INTEGER DEFAULT 5;
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "aiCooldownSeconds" INTEGER DEFAULT 30;
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "maxBudgetPerTicketBrl" DECIMAL(10,2) DEFAULT 2.00;
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "rateLimitAction" TEXT DEFAULT 'pause';
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "aiDisabledReason" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "aiTotalCostBrl" DECIMAL(10,4) DEFAULT 0;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "lastAiResponseAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "ai_rate_limit_events" (
    "id" TEXT NOT NULL, "ticketId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL, "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_rate_limit_events_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "ai_rate_limit_events_companyId_createdAt_idx" ON "ai_rate_limit_events"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_rate_limit_events_ticketId_createdAt_idx" ON "ai_rate_limit_events"("ticketId", "createdAt");
