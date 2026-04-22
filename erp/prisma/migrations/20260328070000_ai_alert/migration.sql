-- CreateTable
CREATE TABLE "ai_alerts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "operator" TEXT NOT NULL DEFAULT 'gt',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_alerts_companyId_metricType_key" ON "ai_alerts"("companyId", "metricType");

-- CreateIndex
CREATE INDEX "ai_alerts_companyId_enabled_idx" ON "ai_alerts"("companyId", "enabled");

-- AddForeignKey
ALTER TABLE "ai_alerts" ADD CONSTRAINT "ai_alerts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
