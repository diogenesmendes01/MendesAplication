/**
 * AI Recovery Queue
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sseBus } from "@/lib/sse";

let _aiAgentQueue: import("bullmq").Queue | null = null;
async function getAiAgentQueue() {
  if (!_aiAgentQueue) {
    const { aiAgentQueue } = await import("@/lib/queue");
    _aiAgentQueue = aiAgentQueue;
  }
  return _aiAgentQueue;
}

export async function markTicketPendingRecovery(ticketId: string): Promise<void> {
  await prisma.ticket.update({ where: { id: ticketId }, data: { aiPendingRecovery: true } });
  await prisma.ticketMessage.create({
    data: {
      ticketId, senderId: null,
      content: "[Sistema] Servi\u00e7o de IA temporariamente indispon\u00edvel. Ticket ser\u00e1 processado automaticamente quando o servi\u00e7o for restaurado.",
      isInternal: true, isAiGenerated: true, channel: "WHATSAPP",
    },
  });
  const incident = await prisma.aiProviderIncident.findFirst({ where: { resolvedAt: null }, orderBy: { startedAt: "desc" } });
  if (incident) {
    await prisma.aiProviderIncident.update({ where: { id: incident.id }, data: { ticketsAffected: { increment: 1 } } });
  }
}

export async function processRecoveryQueue(): Promise<{ processed: number; failed: number }> {
  const pendingTickets = await prisma.ticket.findMany({
    where: { aiPendingRecovery: true },
    orderBy: [{ priority: "desc" }, { slaBreached: "desc" }, { createdAt: "asc" }],
    take: 20,
    include: { messages: { where: { isInternal: false }, orderBy: { createdAt: "desc" }, take: 1, select: { content: true } } },
  });
  if (pendingTickets.length === 0) return { processed: 0, failed: 0 };

  logger.info({ count: pendingTickets.length }, "[recovery] Processing pending tickets");
  const companyIds = [...new Set(pendingTickets.map((t) => t.companyId))];
  for (const cid of companyIds) sseBus.publish(`company:${cid}:system`, "ai-recovery-started", { ticketCount: pendingTickets.length });

  const queue = await getAiAgentQueue();
  let processed = 0, failed = 0;

  for (const ticket of pendingTickets) {
    try {
      await queue.add("process", {
        ticketId: ticket.id, companyId: ticket.companyId,
        messageContent: ticket.messages[0]?.content || "",
        channel: (ticket as any).channelType || "WHATSAPP", isRecovery: true,
      });
      await prisma.ticket.update({ where: { id: ticket.id }, data: { aiPendingRecovery: false } });
      processed++;
    } catch (error) {
      logger.error({ ticketId: ticket.id, error }, "[recovery] Failed to requeue ticket");
      failed++;
    }
  }

  const incident = await prisma.aiProviderIncident.findFirst({ where: { resolvedAt: { not: null } }, orderBy: { resolvedAt: "desc" } });
  if (incident) await prisma.aiProviderIncident.update({ where: { id: incident.id }, data: { ticketsRecovered: { increment: processed } } });

  for (const cid of companyIds) sseBus.publish(`company:${cid}:system`, "ai-recovery-complete", { ticketsProcessed: processed, ticketsFailed: failed });
  logger.info({ processed, failed }, "[recovery] Recovery queue processed");
  return { processed, failed };
}

export async function getPendingRecoveryCount(companyId?: string): Promise<number> {
  return prisma.ticket.count({ where: { aiPendingRecovery: true, ...(companyId ? { companyId } : {}) } });
}
