-- SLA Management Phase 1

ALTER TABLE "sla_configs" ADD COLUMN "channelType" TEXT;
ALTER TABLE "sla_configs" ADD COLUMN "escalateToRole" TEXT;
ALTER TABLE "sla_configs" ADD COLUMN "autoEscalate" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sla_configs" ADD COLUMN "autoPriorityBump" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sla_configs" ADD COLUMN "businessHoursOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sla_configs" ADD COLUMN "businessHoursStart" INTEGER DEFAULT 8;
ALTER TABLE "sla_configs" ADD COLUMN "businessHoursEnd" INTEGER DEFAULT 18;

DROP INDEX IF EXISTS "sla_configs_companyId_type_priority_stage_key";
CREATE UNIQUE INDEX "sla_configs_companyId_type_priority_stage_channelType_key"
  ON "sla_configs" ("companyId", "type", "priority", "stage", "channelType");
CREATE INDEX "sla_configs_companyId_type_channelType_idx"
  ON "sla_configs" ("companyId", "type", "channelType");

ALTER TABLE "tickets" ADD COLUMN "slaFirstReplyAt" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "slaResolvedAt" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "slaEscalatedAt" TIMESTAMP(3);

CREATE TABLE "sla_violations" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "deadlineMinutes" INTEGER NOT NULL,
    "actualMinutes" INTEGER NOT NULL,
    "breachedAt" TIMESTAMP(3) NOT NULL,
    "escalatedTo" TEXT,
    "previousAssignee" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sla_violations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sla_violations_companyId_createdAt_idx" ON "sla_violations"("companyId", "createdAt");
CREATE INDEX "sla_violations_companyId_channel_createdAt_idx" ON "sla_violations"("companyId", "channel", "createdAt");
CREATE INDEX "sla_violations_companyId_stage_createdAt_idx" ON "sla_violations"("companyId", "stage", "createdAt");

ALTER TABLE "sla_violations" ADD CONSTRAINT "sla_violations_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sla_violations" ADD CONSTRAINT "sla_violations_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
