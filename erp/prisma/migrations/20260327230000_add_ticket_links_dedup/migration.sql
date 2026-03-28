-- AlterEnum: Add MERGED to TicketStatus
ALTER TYPE "TicketStatus" ADD VALUE 'MERGED';

-- AlterTable: Add merge fields to tickets
ALTER TABLE "tickets" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "mergedAt" TIMESTAMP(3);

-- CreateTable: ticket_links
CREATE TABLE "ticket_links" (
    "id" TEXT NOT NULL,
    "ticketAId" TEXT NOT NULL,
    "ticketBId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "detectedBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ticket_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_links_ticketAId_ticketBId_key" ON "ticket_links"("ticketAId", "ticketBId");
CREATE INDEX "ticket_links_ticketAId_status_idx" ON "ticket_links"("ticketAId", "status");
CREATE INDEX "ticket_links_ticketBId_status_idx" ON "ticket_links"("ticketBId", "status");

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_ticketAId_fkey" FOREIGN KEY ("ticketAId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_ticketBId_fkey" FOREIGN KEY ("ticketBId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
