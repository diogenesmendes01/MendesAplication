-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "sharedClientGroupId" TEXT;

-- CreateTable
CREATE TABLE "shared_client_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_client_groups_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_sharedClientGroupId_fkey" FOREIGN KEY ("sharedClientGroupId") REFERENCES "shared_client_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
