-- Bug #4: Add boletoId FK to AccountReceivable for direct join instead of heuristic matching
ALTER TABLE "accounts_receivable" ADD COLUMN "boletoId" TEXT;

-- Create index on boletoId for fast lookups
CREATE INDEX "accounts_receivable_boletoId_idx" ON "accounts_receivable"("boletoId");

-- Add foreign key constraint
ALTER TABLE "accounts_receivable"
  ADD CONSTRAINT "accounts_receivable_boletoId_fkey"
  FOREIGN KEY ("boletoId") REFERENCES "boletos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bug #20: Partial unique index to enforce at most one isDefault=true per company
CREATE UNIQUE INDEX "payment_providers_companyId_isDefault_unique"
  ON "payment_providers" ("companyId")
  WHERE "isDefault" = true;
