import { QUEUE_NAMES, emailInboundQueue, slaCheckQueue } from '../queue'
import { createWorker } from './base'
import { processEmailInbound } from './email-inbound'
import { processEmailOutbound } from './email-outbound'
import { processWhatsAppInbound } from './whatsapp-inbound'
import { processWhatsAppOutbound } from './whatsapp-outbound'
import { processSlaCheck } from './sla-check'

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

// Set up repeatable job for SLA checks (every 1 minute)
slaCheckQueue.upsertJobScheduler(
  'sla-check-poll',
  { every: 1 * 60 * 1000 },
  { name: 'check-sla' }
).then(() => {
  console.log('[sla-check] Repeatable SLA check job scheduled (every 1 min)')
}).catch((err) => {
  console.error('[sla-check] Failed to schedule repeatable job:', err)
})

const emailInboundWorker = createWorker(QUEUE_NAMES.EMAIL_INBOUND, processEmailInbound)

const emailOutboundWorker = createWorker(QUEUE_NAMES.EMAIL_OUTBOUND, processEmailOutbound)

const whatsappInboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_INBOUND, processWhatsAppInbound)

const whatsappOutboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_OUTBOUND, processWhatsAppOutbound)

const slaCheckWorker = createWorker(QUEUE_NAMES.SLA_CHECK, processSlaCheck)

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
