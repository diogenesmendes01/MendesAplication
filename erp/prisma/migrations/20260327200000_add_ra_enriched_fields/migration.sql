-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "raReason" TEXT;
ALTER TABLE "tickets" ADD COLUMN "raFeeling" TEXT;
ALTER TABLE "tickets" ADD COLUMN "raCategories" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tickets" ADD COLUMN "raPublicTreatmentTime" TEXT;
ALTER TABLE "tickets" ADD COLUMN "raPrivateTreatmentTime" TEXT;
ALTER TABLE "tickets" ADD COLUMN "raRatingDate" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "raCommentsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tickets" ADD COLUMN "raUnreadCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tickets" ADD COLUMN "raWhatsappEvalSent" BOOLEAN;
ALTER TABLE "tickets" ADD COLUMN "raWhatsappEvalDone" BOOLEAN;
ALTER TABLE "tickets" ADD COLUMN "raActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tickets" ADD COLUMN "raModerationStatus" TEXT;
