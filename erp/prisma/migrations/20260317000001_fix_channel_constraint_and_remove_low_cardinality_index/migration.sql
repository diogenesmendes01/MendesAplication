-- WARN-1: Add CHECK constraint to enforce valid channel values in ai_usage_logs.
-- Previously `channel` was unconstrained TEXT; values like "SMS" or "email" (lowercase)
-- could be persisted silently, breaking channel breakdown in the Consumo dashboard.
--
-- NOTE: The low-cardinality @@index([isSimulation]) was already addressed in
-- migration 20260316000001 by replacing it with the compound index
-- (companyId, isSimulation, createdAt), which is efficiently used by getTodaySpend.
ALTER TABLE "ai_usage_logs"
  ADD CONSTRAINT "ai_usage_logs_channel_check"
  CHECK ("channel" IN ('WHATSAPP', 'EMAIL'));
