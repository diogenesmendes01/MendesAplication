import { Queue } from 'bullmq'

function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  }
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const connection = {
  ...parseRedisUrl(REDIS_URL),
  maxRetriesPerRequest: null,
}

export const QUEUE_NAMES = {
  EMAIL_INBOUND: 'email-inbound',
  EMAIL_OUTBOUND: 'email-outbound',
  WHATSAPP_INBOUND: 'whatsapp-inbound',
  WHATSAPP_OUTBOUND: 'whatsapp-outbound',
  SLA_CHECK: 'sla-check',
  AI_AGENT: 'ai-agent',
  DOCUMENT_PROCESSING: 'document-processing',
  RECLAMEAQUI_INBOUND: 'reclameaqui-inbound',
  RECLAMEAQUI_OUTBOUND: 'reclameaqui-outbound',
  ATTACHMENT_EXTRACTION: 'attachment-extraction',
  AI_HEALTH_CHECK: 'ai-health-check',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

// Outbound RA jobs should NOT retry automatically (business logic errors, not transient)
const noRetryJobOptions = {
  attempts: 1,
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

// Extraction jobs
const extractionJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

export const emailInboundQueue = new Queue(QUEUE_NAMES.EMAIL_INBOUND, { connection, defaultJobOptions })
export const emailOutboundQueue = new Queue(QUEUE_NAMES.EMAIL_OUTBOUND, { connection, defaultJobOptions })
export const whatsappInboundQueue = new Queue(QUEUE_NAMES.WHATSAPP_INBOUND, { connection, defaultJobOptions })
export const whatsappOutboundQueue = new Queue(QUEUE_NAMES.WHATSAPP_OUTBOUND, { connection, defaultJobOptions })
export const slaCheckQueue = new Queue(QUEUE_NAMES.SLA_CHECK, { connection })
export const aiAgentQueue = new Queue(QUEUE_NAMES.AI_AGENT, { connection, defaultJobOptions })
export const documentProcessingQueue = new Queue(QUEUE_NAMES.DOCUMENT_PROCESSING, { connection, defaultJobOptions })
export const reclameaquiInboundQueue = new Queue(QUEUE_NAMES.RECLAMEAQUI_INBOUND, { connection, defaultJobOptions })
export const reclameaquiOutboundQueue = new Queue(QUEUE_NAMES.RECLAMEAQUI_OUTBOUND, { connection, defaultJobOptions: noRetryJobOptions })

export const extractionQueue = new Queue(QUEUE_NAMES.ATTACHMENT_EXTRACTION, { connection, defaultJobOptions: extractionJobOptions })

export const aiHealthCheckQueue = new Queue(QUEUE_NAMES.AI_HEALTH_CHECK, { connection, defaultJobOptions })
