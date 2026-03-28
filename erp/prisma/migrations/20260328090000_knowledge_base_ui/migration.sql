-- Knowledge Base UI: Add fields to documents + create document_versions

-- New columns on documents
ALTER TABLE "documents" ADD COLUMN "content" TEXT;
ALTER TABLE "documents" ADD COLUMN "category" TEXT;
ALTER TABLE "documents" ADD COLUMN "tags" TEXT[] DEFAULT '{}';
ALTER TABLE "documents" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "documents" ADD COLUMN "sourceFile" TEXT;
ALTER TABLE "documents" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "documents" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "documents" ADD COLUMN "createdById" TEXT;
ALTER TABLE "documents" ADD COLUMN "updatedById" TEXT;

-- Indexes
CREATE INDEX "documents_companyId_isActive_idx" ON "documents"("companyId", "isActive");
CREATE INDEX "documents_companyId_category_idx" ON "documents"("companyId", "category");

-- Foreign keys to users
ALTER TABLE "documents" ADD CONSTRAINT "documents_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DocumentVersion table
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[] DEFAULT '{}',
    "changedBy" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_versions_documentId_version_key" ON "document_versions"("documentId", "version");
CREATE INDEX "document_versions_documentId_idx" ON "document_versions"("documentId");

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
