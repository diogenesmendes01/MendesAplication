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
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[${queueName}] Job ${job?.id} failed:`, err.message)
  })

  worker.on('ready', () => {
    console.log(`[${queueName}] Worker ready`)
  })

  return worker
}
