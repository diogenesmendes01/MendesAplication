-- CreateIndex
CREATE INDEX "clients_companyId_createdAt_idx" ON "clients"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_companyId_status_createdAt_idx" ON "invoices"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "proposals_companyId_status_createdAt_idx" ON "proposals"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "tax_entries_companyId_status_dueDate_idx" ON "tax_entries"("companyId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ai_usage_logs_companyId_isSimulation_idx" ON "ai_usage_logs"("companyId", "isSimulation");

-- CreateIndex
CREATE INDEX "documents_companyId_createdAt_idx" ON "documents"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");

-- CreateIndex
CREATE INDEX "fiscal_configs_companyId_idx" ON "fiscal_configs"("companyId");

-- CreateIndex
CREATE INDEX "additional_contacts_clientId_idx" ON "additional_contacts"("clientId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "refunds_companyId_status_requestedAt_idx" ON "refunds"("companyId", "status", "requestedAt");
