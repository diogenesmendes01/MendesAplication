-- Bug C fix: Add indexes for webhook lookups (gatewayId) and status queries (companyId, status)
-- CreateIndex
CREATE INDEX "boletos_gatewayId_idx" ON "boletos"("gatewayId");

-- CreateIndex
CREATE INDEX "boletos_companyId_status_idx" ON "boletos"("companyId", "status");
