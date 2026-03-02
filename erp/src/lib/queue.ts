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
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

export const emailInboundQueue = new Queue(QUEUE_NAMES.EMAIL_INBOUND, { connection })
export const emailOutboundQueue = new Queue(QUEUE_NAMES.EMAIL_OUTBOUND, { connection })
export const whatsappInboundQueue = new Queue(QUEUE_NAMES.WHATSAPP_INBOUND, { connection })
export const whatsappOutboundQueue = new Queue(QUEUE_NAMES.WHATSAPP_OUTBOUND, { connection })
export const slaCheckQueue = new Queue(QUEUE_NAMES.SLA_CHECK, { connection })
