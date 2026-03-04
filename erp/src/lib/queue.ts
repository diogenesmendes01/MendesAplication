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
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
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
