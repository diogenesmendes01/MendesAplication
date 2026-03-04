import { Worker, Job } from 'bullmq'
import { connection, type QueueName } from '@/lib/queue'

export function createWorker(
  queueName: QueueName,
  processor: (job: Job) => Promise<void>
): Worker {
  const worker = new Worker(
    queueName,
    async (job: Job) => {
      console.log(`[${queueName}] Processing job ${job.id}:`, job.name, job.data)
      try {
        await processor(job)
        console.log(`[${queueName}] Job ${job.id} completed`)
      } catch (error) {
        console.error(`[${queueName}] Job ${job.id} failed:`, error)
        throw error
      }
    },
    {
      connection,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    }
  )

  worker.on('failed', (job, err) => {
    const attemptsMade = job?.attemptsMade ?? 0
    const maxAttempts = job?.opts?.attempts ?? 1
    console.error(
      `[${queueName}] Job ${job?.id} failed (attempt ${attemptsMade}/${maxAttempts}):`,
      err.message
    )
  })

  worker.on('stalled', (jobId) => {
    console.warn(`[${queueName}] Job ${jobId} stalled`)
  })

  worker.on('ready', () => {
    console.log(`[${queueName}] Worker ready`)
  })

  return worker
}
