import { Worker, Job } from 'bullmq'
import { connection, type QueueName } from '@/lib/queue'
import { logger } from "@/lib/logger";

export function createWorker(
  queueName: QueueName,
  processor: (job: Job) => Promise<void>,
  concurrency = 1
): Worker {
  const worker = new Worker(
    queueName,
    async (job: Job) => {
      logger.info(`[${queueName}] Processing job ${job.id}:`, job.name, job.data)
      try {
        await processor(job)
        logger.info(`[${queueName}] Job ${job.id} completed`)
      } catch (error) {
        logger.error(`[${queueName}] Job ${job.id} failed:`, error)
        throw error
      }
    },
    {
      connection,
      concurrency,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    }
  )

  worker.on('failed', (job, err) => {
    const attemptsMade = job?.attemptsMade ?? 0
    const maxAttempts = job?.opts?.attempts ?? 1
    logger.error(
      `[${queueName}] Job ${job?.id} failed (attempt ${attemptsMade}/${maxAttempts}):`,
      err.message
    )
  })

  worker.on('stalled', (jobId) => {
    logger.warn(`[${queueName}] Job ${jobId} stalled`)
  })

  worker.on('ready', () => {
    logger.info(`[${queueName}] Worker ready`)
  })

  return worker
}
