import { Job } from "bullmq";
import { runHealthCheckCycle, cleanupOldHealthChecks } from "@/lib/ai/health-checker";
import { processRecoveryQueue } from "@/lib/ai/recovery";
import { logger } from "@/lib/logger";

interface HealthCheckJobData {
  triggerRecovery?: boolean;
  cleanup?: boolean;
}

export async function processAiHealthCheck(job: Job<HealthCheckJobData>): Promise<void> {
  const { triggerRecovery, cleanup } = job.data || {};
  try {
    const results = await runHealthCheckCycle();
    logger.info({ results: results.map((r) => ({ provider: r.provider, model: r.model, status: r.status, latencyMs: r.latencyMs })) }, "[ai-health-check] Cycle complete");
    const hasRecovery = results.some((r) => r.status === "up" || r.status === "degraded");
    if (hasRecovery || triggerRecovery) {
      const recovery = await processRecoveryQueue();
      if (recovery.processed > 0) logger.info({ processed: recovery.processed, failed: recovery.failed }, "[ai-health-check] Recovery processed");
    }
    if (cleanup || Math.random() < 0.01) {
      const deleted = await cleanupOldHealthChecks(7);
      if (deleted > 0) logger.info({ deleted }, "[ai-health-check] Cleaned old records");
    }
  } catch (error) {
    logger.error({ error }, "[ai-health-check] Cycle failed");
    throw error;
  }
}
