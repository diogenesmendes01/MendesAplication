-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'PENDING_APPROVAL', 'DISCARDED');

-- AlterTable
ALTER TABLE "ticket_messages" ALTER COLUMN "deliveryStatus" TYPE "MessageDeliveryStatus" USING "deliveryStatus"::"MessageDeliveryStatus";
