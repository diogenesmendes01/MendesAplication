-- AddColumn: raHugmeId — internal HugMe ticket ID used for API calls
-- Fixes 404 errors when sending messages (was using source_external_id instead of id)
ALTER TABLE "tickets" ADD COLUMN "raHugmeId" TEXT;

-- AddColumn: raFormFields — custom form fields from RA complaint
-- Stores answers from the consumer's complaint form as JSON array [{name, value}]
ALTER TABLE "tickets" ADD COLUMN "raFormFields" JSONB;
