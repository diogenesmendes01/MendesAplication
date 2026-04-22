-- AlterTable: add channel column to ai_config (nullable, NULL = global default)
ALTER TABLE "ai_config" ADD COLUMN "channel" "ChannelType";

-- DropIndex: remove old single-column unique on companyId
DROP INDEX IF EXISTS "ai_config_companyId_key";

-- CreateIndex: composite unique on (companyId, channel)
-- Handles uniqueness for non-NULL channel values.
CREATE UNIQUE INDEX "ai_config_companyId_channel_key" ON "ai_config"("companyId", "channel");

-- CreateIndex: partial unique index for the NULL channel case.
-- PostgreSQL treats NULLs as distinct in unique indexes, so the composite
-- index above does NOT prevent duplicate (companyId, NULL) rows.
-- This partial index ensures at most one global config per company.
CREATE UNIQUE INDEX "ai_config_company_global_unique" ON "ai_config" ("companyId") WHERE "channel" IS NULL;
