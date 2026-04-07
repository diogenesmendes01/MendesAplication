-- Add cobrefacilConfig field to Company model
-- Stores per-company Cobre Fácil configuration (address, etc.)
ALTER TABLE "companies" ADD COLUMN "cobrefacilConfig" JSONB;
