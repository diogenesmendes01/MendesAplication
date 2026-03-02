import { QUEUE_NAMES, emailInboundQueue } from '../queue'
import { createWorker } from './base'
import { processEmailInbound } from './email-inbound'
import { processEmailOutbound } from './email-outbound'
import { processWhatsAppInbound } from './whatsapp-inbound'
import { processWhatsAppOutbound } from './whatsapp-outbound'

console.log('Starting workers...')

// Set up repeatable job for email inbound polling (every 2 minutes)
emailInboundQueue.upsertJobScheduler(
  'email-inbound-poll',
  { every: 2 * 60 * 1000 },
  { name: 'poll-emails' }
).then(() => {
  console.log('[email-inbound] Repeatable poll job scheduled (every 2 min)')
}).catch((err) => {
  console.error('[email-inbound] Failed to schedule repeatable job:', err)
})

const emailInboundWorker = createWorker(QUEUE_NAMES.EMAIL_INBOUND, processEmailInbound)

const emailOutboundWorker = createWorker(QUEUE_NAMES.EMAIL_OUTBOUND, processEmailOutbound)

const whatsappInboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_INBOUND, processWhatsAppInbound)

const whatsappOutboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_OUTBOUND, processWhatsAppOutbound)

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
