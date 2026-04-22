-- CreateTable: AiProviderHealth
CREATE TABLE "ai_provider_health" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_provider_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_health_provider_checkedAt_idx" ON "ai_provider_health"("provider", "checkedAt");
CREATE INDEX "ai_provider_health_status_idx" ON "ai_provider_health"("status");

-- CreateTable: AiProviderIncident
CREATE TABLE "ai_provider_incidents" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "ticketsAffected" INTEGER NOT NULL DEFAULT 0,
    "ticketsRecovered" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_provider_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_incidents_provider_createdAt_idx" ON "ai_provider_incidents"("provider", "createdAt");
CREATE INDEX "ai_provider_incidents_resolvedAt_idx" ON "ai_provider_incidents"("resolvedAt");

-- AlterTable: AiConfig — add fallback fields
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "fallbackChain" JSONB;
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "healthCheckEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "healthCheckIntervalMs" INTEGER NOT NULL DEFAULT 120000;
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "humanOnlyModeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Ticket — add recovery flag
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "aiPendingRecovery" BOOLEAN NOT NULL DEFAULT false;
