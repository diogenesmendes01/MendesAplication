-- AlterTable: make userId nullable in audit_logs to support system-generated audit events
-- (e.g. SLA worker, cron jobs) that run without an authenticated user session.

ALTER TABLE "audit_logs" ALTER COLUMN "userId" DROP NOT NULL;
