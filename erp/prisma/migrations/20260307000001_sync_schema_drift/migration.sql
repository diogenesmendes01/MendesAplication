-- ============================================================
-- Migration: sync_schema_drift
-- Fecha o gap entre prisma/schema.prisma e as migrations existentes.
-- Idempotente: usa IF NOT EXISTS em tudo — safe pra rodar em banco
-- que já tem parte dos objetos criados via prisma db push.
-- ============================================================

-- ============================================================
-- 1. ENUMS FALTANTES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "ChannelType" AS ENUM ('EMAIL', 'WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageOrigin" AS ENUM ('SYSTEM', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SlaType" AS ENUM ('TICKET', 'REFUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RefundPaymentMethod" AS ENUM ('PIX', 'TED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RefundAttachmentType" AS ENUM ('PAYMENT_PROOF', 'REFUND_PROOF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RefundInvoiceAction" AS ENUM ('CANCEL_INVOICE', 'CREDIT_NOTE', 'NONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayableOrigin" AS ENUM ('MANUAL', 'REFUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DocumentStatus" AS ENUM ('PROCESSING', 'READY', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceType" AS ENUM ('STANDARD', 'CREDIT_NOTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TaxRegime" AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. VALORES FALTANTES EM ENUMS EXISTENTES
-- ============================================================

-- PaymentStatus: adicionar CANCELLED
DO $$ BEGIN
  ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
EXCEPTION WHEN others THEN NULL; END $$;

-- TaxStatus: adicionar CANCELLED
DO $$ BEGIN
  ALTER TYPE "TaxStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
EXCEPTION WHEN others THEN NULL; END $$;

-- ProposalStatus: adicionar CANCELLED
DO $$ BEGIN
  ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
EXCEPTION WHEN others THEN NULL; END $$;

-- ============================================================
-- 3. COLUNAS FALTANTES EM TABELAS EXISTENTES
-- ============================================================

-- invoices: campos de cancelamento, tipo e nota de crédito
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "type"                "InvoiceType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS "cancelledAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationReason"  TEXT,
  ADD COLUMN IF NOT EXISTS "refundId"            TEXT,
  ADD COLUMN IF NOT EXISTS "originalInvoiceId"   TEXT;

-- accounts_payable: origem e referência de reembolso
ALTER TABLE "accounts_payable"
  ADD COLUMN IF NOT EXISTS "origin"    "PayableOrigin" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "refundId"  TEXT;

-- tax_entries: referência de nota fiscal
ALTER TABLE "tax_entries"
  ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;

-- tickets: campos de canal, SLA e IA
ALTER TABLE "tickets"
  ADD COLUMN IF NOT EXISTS "channelId"     TEXT,
  ADD COLUMN IF NOT EXISTS "contactId"     TEXT,
  ADD COLUMN IF NOT EXISTS "slaFirstReply" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaResolution" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaBreached"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "slaAtRisk"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tags"          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "aiEnabled"     BOOLEAN NOT NULL DEFAULT true;

-- ticket_messages: campos de canal, direção, origem, IA e entrega
-- senderId pode ser NULL (remetente externo/IA)
ALTER TABLE "ticket_messages"
  ALTER COLUMN "senderId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "channel"        "ChannelType",
  ADD COLUMN IF NOT EXISTS "direction"      "MessageDirection" NOT NULL DEFAULT 'OUTBOUND',
  ADD COLUMN IF NOT EXISTS "origin"         "MessageOrigin" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS "externalId"     TEXT,
  ADD COLUMN IF NOT EXISTS "contactId"      TEXT,
  ADD COLUMN IF NOT EXISTS "isInternal"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isAiGenerated"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;

-- ============================================================
-- 4. TABELAS FALTANTES
-- ============================================================

-- additional_contacts
CREATE TABLE IF NOT EXISTS "additional_contacts" (
    "id"        TEXT NOT NULL,
    "clientId"  TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "role"      TEXT,
    "email"     TEXT,
    "whatsapp"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "additional_contacts_pkey" PRIMARY KEY ("id")
);

-- channels
CREATE TABLE IF NOT EXISTS "channels" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "type"            "ChannelType" NOT NULL,
    "name"            TEXT NOT NULL,
    "config"          JSONB NOT NULL,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "lastSyncUid"     INTEGER,
    "lastSyncUidSent" INTEGER,
    "lastSyncAt"      TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- sla_configs
CREATE TABLE IF NOT EXISTS "sla_configs" (
    "id"                 TEXT NOT NULL,
    "companyId"          TEXT NOT NULL,
    "type"               "SlaType" NOT NULL,
    "priority"           "TicketPriority",
    "stage"              TEXT NOT NULL,
    "deadlineMinutes"    INTEGER NOT NULL,
    "alertBeforeMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sla_configs_pkey" PRIMARY KEY ("id")
);

-- attachments
CREATE TABLE IF NOT EXISTS "attachments" (
    "id"              TEXT NOT NULL,
    "ticketMessageId" TEXT,
    "ticketId"        TEXT,
    "fileName"        TEXT NOT NULL,
    "fileSize"        INTEGER NOT NULL,
    "mimeType"        TEXT NOT NULL,
    "storagePath"     TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- refunds
CREATE TABLE IF NOT EXISTS "refunds" (
    "id"                  TEXT NOT NULL,
    "ticketId"            TEXT NOT NULL,
    "companyId"           TEXT NOT NULL,
    "requestedById"       TEXT NOT NULL,
    "approvedById"        TEXT,
    "executedById"        TEXT,
    "amount"              DECIMAL(12,2) NOT NULL,
    "paymentMethod"       "RefundPaymentMethod",
    "bankName"            TEXT,
    "bankAgency"          TEXT,
    "bankAccount"         TEXT,
    "pixKey"              TEXT,
    "justification"       TEXT,
    "boletoId"            TEXT,
    "status"              "RefundStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "rejectionReason"     TEXT,
    "requestedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt"          TIMESTAMP(3),
    "executedAt"          TIMESTAMP(3),
    "completedAt"         TIMESTAMP(3),
    "slaDeadline"         TIMESTAMP(3),
    "slaBreached"         BOOLEAN NOT NULL DEFAULT false,
    "slaAtRisk"           BOOLEAN NOT NULL DEFAULT false,
    "invoiceAction"       "RefundInvoiceAction",
    "invoiceCancelReason" TEXT,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- refund_attachments
CREATE TABLE IF NOT EXISTS "refund_attachments" (
    "id"           TEXT NOT NULL,
    "refundId"     TEXT NOT NULL,
    "type"         "RefundAttachmentType" NOT NULL,
    "fileName"     TEXT NOT NULL,
    "fileSize"     INTEGER NOT NULL,
    "mimeType"     TEXT NOT NULL,
    "storagePath"  TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refund_attachments_pkey" PRIMARY KEY ("id")
);

-- baileys_auth_state
CREATE TABLE IF NOT EXISTS "baileys_auth_state" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "keyType"   TEXT NOT NULL,
    "keyId"     TEXT NOT NULL,
    "keyData"   JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "baileys_auth_state_pkey" PRIMARY KEY ("id")
);

-- lid_mappings
CREATE TABLE IF NOT EXISTS "lid_mappings" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "lid"         TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lid_mappings_pkey" PRIMARY KEY ("id")
);

-- ai_config
CREATE TABLE IF NOT EXISTS "ai_config" (
    "id"                 TEXT NOT NULL,
    "companyId"          TEXT NOT NULL,
    "enabled"            BOOLEAN NOT NULL DEFAULT false,
    "persona"            TEXT NOT NULL,
    "welcomeMessage"     TEXT,
    "escalationKeywords" TEXT[] NOT NULL DEFAULT '{}',
    "maxIterations"      INTEGER NOT NULL DEFAULT 5,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_config_pkey" PRIMARY KEY ("id")
);

-- documents
CREATE TABLE IF NOT EXISTS "documents" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "mimeType"  TEXT NOT NULL,
    "fileSize"  INTEGER NOT NULL,
    "status"    "DocumentStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- document_chunks
CREATE TABLE IF NOT EXISTS "document_chunks" (
    "id"         TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content"    TEXT NOT NULL,
    "embedding"  DOUBLE PRECISION[] NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- fiscal_configs (tabela criada fora das migrations originais)
CREATE TABLE IF NOT EXISTS "fiscal_configs" (
    "id"                        TEXT NOT NULL,
    "companyId"                 TEXT NOT NULL,
    "taxRegime"                 "TaxRegime" NOT NULL DEFAULT 'SIMPLES_NACIONAL',
    "issRate"                   DECIMAL(5,2) NOT NULL DEFAULT 5,
    "pisRate"                   DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cofinsRate"                DECIMAL(5,2) NOT NULL DEFAULT 0,
    "irpjRate"                  DECIMAL(5,2) NOT NULL DEFAULT 0,
    "csllRate"                  DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cnae"                      TEXT,
    "inscricaoMunicipal"        TEXT,
    "codigoMunicipio"           TEXT,
    "nfseSerieNumber"           TEXT NOT NULL DEFAULT '1',
    "nfseNextNumber"            INTEGER NOT NULL DEFAULT 1,
    "nfeSerieNumber"            TEXT NOT NULL DEFAULT '1',
    "nfeNextNumber"             INTEGER NOT NULL DEFAULT 1,
    "autoEmitNfse"              BOOLEAN NOT NULL DEFAULT false,
    "certificadoPfx"            TEXT,
    "certificadoSenha"          TEXT,
    "certificadoToken1"         TEXT,
    "certificadoToken2"         TEXT,
    "itemListaServico"          TEXT,
    "codigoTributacaoMunicipio" TEXT,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                 TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fiscal_configs_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 5. UNIQUE CONSTRAINTS FALTANTES
-- ============================================================

DO $$ BEGIN
  ALTER TABLE "fiscal_configs" ADD CONSTRAINT "fiscal_configs_companyId_key" UNIQUE ("companyId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_config" ADD CONSTRAINT "ai_config_companyId_key" UNIQUE ("companyId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refundId_key" UNIQUE ("refundId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_refundId_key" UNIQUE ("refundId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sla_configs" ADD CONSTRAINT "sla_configs_companyId_type_priority_stage_key"
    UNIQUE ("companyId", "type", "priority", "stage");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "baileys_auth_state" ADD CONSTRAINT "baileys_auth_state_companyId_keyType_keyId_key"
    UNIQUE ("companyId", "keyType", "keyId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "lid_mappings" ADD CONSTRAINT "lid_mappings_companyId_lid_key"
    UNIQUE ("companyId", "lid");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_externalId_channel_key"
    UNIQUE ("externalId", "channel");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- ============================================================
-- 6. INDEXES FALTANTES
-- ============================================================

CREATE INDEX IF NOT EXISTS "clients_companyId_idx"
  ON "clients"("companyId");

CREATE INDEX IF NOT EXISTS "accounts_receivable_companyId_status_dueDate_idx"
  ON "accounts_receivable"("companyId", "status", "dueDate");

CREATE INDEX IF NOT EXISTS "accounts_payable_companyId_status_dueDate_idx"
  ON "accounts_payable"("companyId", "status", "dueDate");

CREATE INDEX IF NOT EXISTS "bank_transactions_companyId_status_idx"
  ON "bank_transactions"("companyId", "status");

CREATE INDEX IF NOT EXISTS "tickets_companyId_status_idx"
  ON "tickets"("companyId", "status");

CREATE INDEX IF NOT EXISTS "tickets_companyId_slaBreached_idx"
  ON "tickets"("companyId", "slaBreached");

CREATE INDEX IF NOT EXISTS "tickets_companyId_clientId_idx"
  ON "tickets"("companyId", "clientId");

CREATE INDEX IF NOT EXISTS "tickets_companyId_assigneeId_idx"
  ON "tickets"("companyId", "assigneeId");

CREATE INDEX IF NOT EXISTS "tickets_companyId_status_updatedAt_idx"
  ON "tickets"("companyId", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "tickets_companyId_slaBreached_status_idx"
  ON "tickets"("companyId", "slaBreached", "status");

CREATE INDEX IF NOT EXISTS "tickets_companyId_status_priority_idx"
  ON "tickets"("companyId", "status", "priority");

CREATE INDEX IF NOT EXISTS "ticket_messages_ticketId_createdAt_idx"
  ON "ticket_messages"("ticketId", "createdAt");

CREATE INDEX IF NOT EXISTS "attachments_ticketId_idx"
  ON "attachments"("ticketId");

CREATE INDEX IF NOT EXISTS "refunds_companyId_status_idx"
  ON "refunds"("companyId", "status");

CREATE INDEX IF NOT EXISTS "refunds_ticketId_idx"
  ON "refunds"("ticketId");

CREATE INDEX IF NOT EXISTS "proposals_companyId_status_idx"
  ON "proposals"("companyId", "status");

CREATE INDEX IF NOT EXISTS "invoices_companyId_status_idx"
  ON "invoices"("companyId", "status");

CREATE INDEX IF NOT EXISTS "tax_entries_companyId_invoiceId_idx"
  ON "tax_entries"("companyId", "invoiceId");

CREATE INDEX IF NOT EXISTS "baileys_auth_state_companyId_idx"
  ON "baileys_auth_state"("companyId");

CREATE INDEX IF NOT EXISTS "lid_mappings_companyId_idx"
  ON "lid_mappings"("companyId");

-- ============================================================
-- 7. FOREIGN KEYS NAS NOVAS TABELAS
-- ============================================================

-- additional_contacts → clients
DO $$ BEGIN
  ALTER TABLE "additional_contacts"
    ADD CONSTRAINT "additional_contacts_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- channels → companies
DO $$ BEGIN
  ALTER TABLE "channels"
    ADD CONSTRAINT "channels_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sla_configs → companies
DO $$ BEGIN
  ALTER TABLE "sla_configs"
    ADD CONSTRAINT "sla_configs_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- attachments → ticket_messages
DO $$ BEGIN
  ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_ticketMessageId_fkey"
    FOREIGN KEY ("ticketMessageId") REFERENCES "ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- attachments → tickets
DO $$ BEGIN
  ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- refunds → tickets
DO $$ BEGIN
  ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- refunds → companies
DO $$ BEGIN
  ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- refunds → users (requestedBy)
DO $$ BEGIN
  ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- refunds → users (approvedBy)
DO $$ BEGIN
  ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- refunds → users (executedBy)
DO $$ BEGIN
  ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_executedById_fkey"
    FOREIGN KEY ("executedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- refund_attachments → refunds
DO $$ BEGIN
  ALTER TABLE "refund_attachments"
    ADD CONSTRAINT "refund_attachments_refundId_fkey"
    FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- refund_attachments → users
DO $$ BEGIN
  ALTER TABLE "refund_attachments"
    ADD CONSTRAINT "refund_attachments_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- baileys_auth_state → companies
DO $$ BEGIN
  ALTER TABLE "baileys_auth_state"
    ADD CONSTRAINT "baileys_auth_state_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- lid_mappings → companies
DO $$ BEGIN
  ALTER TABLE "lid_mappings"
    ADD CONSTRAINT "lid_mappings_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ai_config → companies
DO $$ BEGIN
  ALTER TABLE "ai_config"
    ADD CONSTRAINT "ai_config_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- documents → companies
DO $$ BEGIN
  ALTER TABLE "documents"
    ADD CONSTRAINT "documents_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- document_chunks → documents
DO $$ BEGIN
  ALTER TABLE "document_chunks"
    ADD CONSTRAINT "document_chunks_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- fiscal_configs → companies
DO $$ BEGIN
  ALTER TABLE "fiscal_configs"
    ADD CONSTRAINT "fiscal_configs_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 8. FOREIGN KEYS NAS COLUNAS NOVAS DE TABELAS EXISTENTES
-- ============================================================

-- tickets.channelId → channels
DO $$ BEGIN
  ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tickets.contactId → additional_contacts
DO $$ BEGIN
  ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "additional_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ticket_messages.contactId → additional_contacts
DO $$ BEGIN
  ALTER TABLE "ticket_messages"
    ADD CONSTRAINT "ticket_messages_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "additional_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- invoices.refundId → refunds
DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_refundId_fkey"
    FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- invoices.originalInvoiceId → invoices (auto-referência para nota de crédito)
DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_originalInvoiceId_fkey"
    FOREIGN KEY ("originalInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- accounts_payable.refundId → refunds
DO $$ BEGIN
  ALTER TABLE "accounts_payable"
    ADD CONSTRAINT "accounts_payable_refundId_fkey"
    FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tax_entries.invoiceId → invoices
DO $$ BEGIN
  ALTER TABLE "tax_entries"
    ADD CONSTRAINT "tax_entries_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
