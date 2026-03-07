-- CreateTable: proposal_events
-- Registra eventos importantes do ciclo de vida da proposta
-- para auditoria e exibição de timeline ao usuário.

CREATE TABLE IF NOT EXISTS "proposal_events" (
    "id"          TEXT NOT NULL,
    "proposalId"  TEXT NOT NULL,
    "type"        TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "userId"      TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "proposal_events_proposalId_createdAt_idx"
    ON "proposal_events"("proposalId", "createdAt");

-- AddForeignKey
ALTER TABLE "proposal_events"
    ADD CONSTRAINT "proposal_events_proposalId_fkey"
    FOREIGN KEY ("proposalId")
    REFERENCES "proposals"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
