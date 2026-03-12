-- CreateTable
CREATE TABLE "payment_providers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_routing_rules" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "clientType" "ClientType",
    "minValue" DECIMAL(12,2),
    "maxValue" DECIMAL(12,2),
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_routing_rules_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "boletos" ADD COLUMN "providerId" TEXT,
ADD COLUMN "gatewayId" TEXT,
ADD COLUMN "gatewayData" JSONB,
ADD COLUMN "manualOverride" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "payment_providers_companyId_isActive_idx" ON "payment_providers"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "payment_routing_rules_providerId_priority_idx" ON "payment_routing_rules"("providerId", "priority");

-- AddForeignKey
ALTER TABLE "boletos" ADD CONSTRAINT "boletos_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "payment_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_providers" ADD CONSTRAINT "payment_providers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_routing_rules" ADD CONSTRAINT "payment_routing_rules_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "payment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
