import { QUEUE_NAMES, emailInboundQueue, slaCheckQueue, reclameaquiInboundQueue } from '../queue'
import { createWorker } from './base'
import { processEmailInbound } from './email-inbound'
import { processEmailOutbound } from './email-outbound'
import { processWhatsAppInbound } from './whatsapp-inbound'
import { processWhatsAppOutbound } from './whatsapp-outbound'
import { processSlaCheck } from './sla-check'
import { processAiAgent } from './ai-agent'
import { processDocumentProcessing } from './document-processor'
import { processReclameAquiInbound } from './reclameaqui-inbound'
import { logger } from "@/lib/logger";

logger.info('Starting workers...')

// Set up repeatable job for email inbound polling (every 2 minutes)
emailInboundQueue.upsertJobScheduler(
  'email-inbound-poll',
  { every: 2 * 60 * 1000 },
  { name: 'poll-emails' }
).then(() => {
  logger.info('[email-inbound] Repeatable poll job scheduled (every 2 min)')
}).catch((err) => {
  logger.error('[email-inbound] Failed to schedule repeatable job:', err)
})

// Set up repeatable job for SLA checks (every 1 minute)
slaCheckQueue.upsertJobScheduler(
  'sla-check-poll',
  { every: 1 * 60 * 1000 },
  { name: 'check-sla' }
).then(() => {
  logger.info('[sla-check] Repeatable SLA check job scheduled (every 1 min)')
}).catch((err) => {
  logger.error('[sla-check] Failed to schedule repeatable job:', err)
})

// Set up repeatable job for Reclame Aqui inbound polling (every 5 minutes)
// RA API has strict rate limits (10 req/min), so we poll less frequently than email
reclameaquiInboundQueue.upsertJobScheduler(
  'reclameaqui-inbound-poll',
  { every: 5 * 60 * 1000 },
  { name: 'poll-reclameaqui' }
).then(() => {
  logger.info('[reclameaqui-inbound] Repeatable poll job scheduled (every 5 min)')
}).catch((err) => {
  logger.error('[reclameaqui-inbound] Failed to schedule repeatable job:', err)
})

const emailInboundWorker = createWorker(QUEUE_NAMES.EMAIL_INBOUND, processEmailInbound, 2)

const emailOutboundWorker = createWorker(QUEUE_NAMES.EMAIL_OUTBOUND, processEmailOutbound, 2)

const whatsappInboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_INBOUND, processWhatsAppInbound, 4)

const whatsappOutboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_OUTBOUND, processWhatsAppOutbound, 3)

const slaCheckWorker = createWorker(QUEUE_NAMES.SLA_CHECK, processSlaCheck)

const aiAgentWorker = createWorker(QUEUE_NAMES.AI_AGENT, processAiAgent, 2)

const documentProcessingWorker = createWorker(QUEUE_NAMES.DOCUMENT_PROCESSING, processDocumentProcessing)

const reclameaquiInboundWorker = createWorker(QUEUE_NAMES.RECLAMEAQUI_INBOUND, processReclameAquiInbound)

const workers = [
  emailInboundWorker,
  emailOutboundWorker,
  whatsappInboundWorker,
  whatsappOutboundWorker,
  slaCheckWorker,
  aiAgentWorker,
  documentProcessingWorker,
  reclameaquiInboundWorker,
]

async function shutdown() {
  logger.info('Shutting down workers...')
  await Promise.all(workers.map((w) => w.close()))
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

logger.info('All workers started. Waiting for jobs...')
