-- AlterEnum
ALTER TYPE "ChannelType" ADD VALUE 'RECLAMEAQUI';

-- AlterTable - Add RA fields to tickets
ALTER TABLE "tickets" ADD COLUMN "raExternalId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "raStatusId" INTEGER;
ALTER TABLE "tickets" ADD COLUMN "raStatusName" TEXT;
ALTER TABLE "tickets" ADD COLUMN "raCanEvaluate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tickets" ADD COLUMN "raCanModerate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tickets" ADD COLUMN "raRating" TEXT;
ALTER TABLE "tickets" ADD COLUMN "raResolvedIssue" BOOLEAN;
ALTER TABLE "tickets" ADD COLUMN "raBackDoingBusiness" BOOLEAN;
ALTER TABLE "tickets" ADD COLUMN "raFrozen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tickets" ADD COLUMN "raConsumerConsideration" TEXT;
ALTER TABLE "tickets" ADD COLUMN "raCompanyConsideration" TEXT;

-- CreateIndex
CREATE INDEX "tickets_companyId_raExternalId_idx" ON "tickets"("companyId", "raExternalId");

-- CreateUniqueIndex (partial - only where raExternalId is not null)
CREATE UNIQUE INDEX "tickets_companyId_raExternalId_key" ON "tickets"("companyId", "raExternalId") WHERE "raExternalId" IS NOT NULL;
