-- AlterTable: add channel column to ai_config (nullable, NULL = global default)
ALTER TABLE "ai_config" ADD COLUMN "channel" "ChannelType";

-- DropIndex: remove old single-column unique on companyId
DROP INDEX IF EXISTS "ai_config_companyId_key";

-- CreateIndex: composite unique on (companyId, channel)
-- Note: PostgreSQL treats NULL as distinct in unique constraints by default,
-- so (companyId, NULL) is unique per company (one global config per company).
CREATE UNIQUE INDEX "ai_config_companyId_channel_key" ON "ai_config"("companyId", "channel");
