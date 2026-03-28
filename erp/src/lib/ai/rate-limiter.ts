import { prisma } from "@/lib/prisma";
import { resolveAiConfig } from "@/lib/ai/resolve-config";
import { logger } from "@/lib/logger";
import type { ChannelType } from "@prisma/client";

export interface RateLimitResult {
  allowed: boolean;
  reason?: "budget_exceeded" | "interaction_limit" | "cooldown" | "ai_disabled";
  delayMs?: number;
  retryAfterSeconds?: number;
}

export interface TicketBudgetUsage {
  usedBrl: number;
  limitBrl: number | null;
  remainingBrl: number | null;
}

export async function checkRateLimit(
  ticketId: string, companyId: string, channel?: ChannelType,
): Promise<RateLimitResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { aiEnabled: true, aiDisabledReason: true, aiTotalCostBrl: true, lastAiResponseAt: true },
  });
  if (!ticket || !ticket.aiEnabled) return { allowed: false, reason: "ai_disabled" };
  const config = await resolveAiConfig(companyId, channel);
  if (!config) return { allowed: true };

  if (config.maxBudgetPerTicketBrl) {
    const cost = Number(ticket.aiTotalCostBrl || 0);
    const limit = Number(config.maxBudgetPerTicketBrl);
    if (cost >= limit) {
      await handleBudgetExceeded(ticketId, companyId, cost, limit, config.rateLimitAction);
      return { allowed: false, reason: "budget_exceeded" };
    }
  }

  if (config.aiCooldownSeconds > 0 && ticket.lastAiResponseAt) {
    const elapsed = Date.now() - ticket.lastAiResponseAt.getTime();
    const cooldownMs = config.aiCooldownSeconds * 1000;
    if (elapsed < cooldownMs) return { allowed: true, delayMs: cooldownMs - elapsed };
  }

  if (config.maxAiInteractionsPerTicketPerHour > 0) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const count = await prisma.aiUsageLog.count({
      where: { ticketId, createdAt: { gte: oneHourAgo }, isSimulation: false },
    });
    if (count >= config.maxAiInteractionsPerTicketPerHour) {
      await handleInteractionLimit(ticketId, companyId, count, config.maxAiInteractionsPerTicketPerHour, config.rateLimitAction);
      return { allowed: false, reason: "interaction_limit", retryAfterSeconds: 3600 };
    }
  }
  return { allowed: true };
}

export async function logInteraction(ticketId: string, costBrl: number): Promise<void> {
  try {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { aiTotalCostBrl: { increment: costBrl }, lastAiResponseAt: new Date() },
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, "[rate-limiter] Failed to log interaction");
  }
}

export async function getTicketBudgetUsage(ticketId: string, companyId: string): Promise<TicketBudgetUsage> {
  const [ticket, config] = await Promise.all([
    prisma.ticket.findUnique({ where: { id: ticketId }, select: { aiTotalCostBrl: true } }),
    resolveAiConfig(companyId),
  ]);
  const usedBrl = Number(ticket?.aiTotalCostBrl || 0);
  const limitBrl = config?.maxBudgetPerTicketBrl ? Number(config.maxBudgetPerTicketBrl) : null;
  return { usedBrl, limitBrl, remainingBrl: limitBrl !== null ? Math.max(0, limitBrl - usedBrl) : null };
}

async function handleBudgetExceeded(ticketId: string, companyId: string, actual: number, limit: number, action: string): Promise<void> {
  logger.info({ ticketId, companyId, actual, limit }, "[rate-limiter] Budget exceeded");
  try {
    await prisma.$transaction([
      prisma.ticket.update({ where: { id: ticketId }, data: { aiEnabled: false, aiDisabledReason: "budget_exceeded", ...(action === "escalate" ? { status: "OPEN" } : {}) } }),
      prisma.aiRateLimitEvent.create({ data: { ticketId, companyId, type: "budget_exceeded", details: { limit, actual: Number(actual.toFixed(4)) } } }),
      prisma.ticketMessage.create({ data: { ticketId, senderId: null, content: `[Rate Limit] Limite de custo IA atingido (R$ ${limit.toFixed(2)}). ${action === "escalate" ? "Ticket transferido para atendimento humano." : "IA pausada neste ticket."}`, isInternal: true, isAiGenerated: true } }),
    ]);
  } catch (err) { logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, "[rate-limiter] Failed to handle budget exceeded"); }
}

async function handleInteractionLimit(ticketId: string, companyId: string, actual: number, limit: number, action: string): Promise<void> {
  logger.info({ ticketId, companyId, actual, limit }, "[rate-limiter] Interaction limit reached");
  try {
    await prisma.$transaction([
      prisma.aiRateLimitEvent.create({ data: { ticketId, companyId, type: "interaction_limit", details: { limit, actual, windowStart: new Date(Date.now() - 60 * 60 * 1000).toISOString() } } }),
      prisma.ticketMessage.create({ data: { ticketId, senderId: null, content: `[Rate Limit] Limite de interacoes IA atingido (${limit}/hora). ${action === "escalate" ? "Ticket escalado para atendimento humano." : "IA pausada temporariamente."}`, isInternal: true, isAiGenerated: true } }),
      ...(action === "escalate" ? [prisma.ticket.update({ where: { id: ticketId }, data: { aiEnabled: false, aiDisabledReason: "rate_limited", status: "OPEN" } })] : []),
    ]);
  } catch (err) { logger.error({ err: err instanceof Error ? err.message : String(err), ticketId }, "[rate-limiter] Failed to handle interaction limit"); }
}
