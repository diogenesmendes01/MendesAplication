import { QUEUE_NAMES } from '../queue'
import { createWorker } from './base'
import { processEmailOutbound } from './email-outbound'

console.log('Starting workers...')

const emailInboundWorker = createWorker(QUEUE_NAMES.EMAIL_INBOUND, async (job) => {
  console.log('Processing email inbound:', job.data)
})

const emailOutboundWorker = createWorker(QUEUE_NAMES.EMAIL_OUTBOUND, processEmailOutbound)

const whatsappInboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_INBOUND, async (job) => {
  console.log('Processing whatsapp inbound:', job.data)
})

const whatsappOutboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_OUTBOUND, async (job) => {
  console.log('Processing whatsapp outbound:', job.data)
})

const slaCheckWorker = createWorker(QUEUE_NAMES.SLA_CHECK, async (job) => {
  console.log('Processing SLA check:', job.data)
})

const workers = [
  emailInboundWorker,
  emailOutboundWorker,
  whatsappInboundWorker,
  whatsappOutboundWorker,
  slaCheckWorker,
]

async function shutdown() {
  console.log('Shutting down workers...')
  await Promise.all(workers.map((w) => w.close()))
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('All workers started. Waiting for jobs...')
