-- US-008: Exclude simulations from daily spend calculations
-- Add isSimulation flag to ai_usage_logs so admin dry-runs do not count
-- against the company's real daily budget (getTodaySpend).
ALTER TABLE "ai_usage_logs" ADD COLUMN "isSimulation" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ai_usage_logs_isSimulation_idx" ON "ai_usage_logs"("isSimulation");
