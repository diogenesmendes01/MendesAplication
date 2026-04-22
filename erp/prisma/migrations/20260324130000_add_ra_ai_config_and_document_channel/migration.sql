-- AlterTable: Add Reclame Aqui fields to AiConfig
ALTER TABLE "ai_config" ADD COLUMN "raEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_config" ADD COLUMN "raMode" TEXT NOT NULL DEFAULT 'suggest';
ALTER TABLE "ai_config" ADD COLUMN "raPrivateBeforePublic" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ai_config" ADD COLUMN "raAutoRequestEvaluation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_config" ADD COLUMN "raEscalationKeywords" TEXT[] DEFAULT ARRAY['processo', 'advogado', 'procon', 'judicial', 'indenização']::TEXT[];

-- AlterTable: Add channel field to Document for KB filtering
ALTER TABLE "documents" ADD COLUMN "channel" "ChannelType";
