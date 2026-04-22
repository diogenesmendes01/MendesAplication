-- CreateTable
CREATE TABLE "erp_providers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.bling.com.br/Api/v3',
    "storeId" TEXT,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "erp_providers_companyId_isActive_idx" ON "erp_providers"("companyId", "isActive");

-- AddForeignKey
ALTER TABLE "erp_providers" ADD CONSTRAINT "erp_providers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
