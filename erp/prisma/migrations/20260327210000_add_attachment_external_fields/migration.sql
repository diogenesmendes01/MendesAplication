-- AlterTable: make storagePath optional, add externalId and externalUrl
ALTER TABLE "attachments" ALTER COLUMN "storagePath" DROP NOT NULL;
ALTER TABLE "attachments" ADD COLUMN "externalId" TEXT;
ALTER TABLE "attachments" ADD COLUMN "externalUrl" TEXT;
