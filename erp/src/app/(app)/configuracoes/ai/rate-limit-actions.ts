"use server";
import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { resolveAiConfig } from "@/lib/ai/resolve-config";
import type { Prisma, ChannelType } from "@prisma/client";

export interface RateLimitConfigData { maxAiInteractionsPerTicketPerHour: number; aiCooldownSeconds: number; maxBudgetPerTicketBrl: number | null; rateLimitAction: "pause" | "escalate"; }
export interface RateLimitEventData { id: string; ticketId: string; type: string; details: Record<string, unknown> | null; createdAt: string; }
export interface TopConsumerData { ticketId: string; subject: string; clientName: string; totalCostBrl: number; interactionCount: number; status: string; }
export interface TopClientConsumerData { clientId: string; clientName: string; cpfCnpj: string; ticketCount: number; totalCostBrl: number; }

export async function getRateLimitConfig(companyId: string, channel?: ChannelType | null): Promise<RateLimitConfigData> {
  await requireCompanyAccess(companyId);
  const config = await resolveAiConfig(companyId, channel);
  if (!config) return { maxAiInteractionsPerTicketPerHour: 5, aiCooldownSeconds: 30, maxBudgetPerTicketBrl: 2.0, rateLimitAction: "pause" };
  return { maxAiInteractionsPerTicketPerHour: config.maxAiInteractionsPerTicketPerHour, aiCooldownSeconds: config.aiCooldownSeconds, maxBudgetPerTicketBrl: config.maxBudgetPerTicketBrl ? Number(config.maxBudgetPerTicketBrl) : null, rateLimitAction: config.rateLimitAction as "pause" | "escalate" };
}

export async function updateRateLimitConfig(companyId: string, data: RateLimitConfigData, channel?: ChannelType | null): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);
  if (!Number.isInteger(data.maxAiInteractionsPerTicketPerHour) || data.maxAiInteractionsPerTicketPerHour < 0 || data.maxAiInteractionsPerTicketPerHour > 100) throw new Error("maxAiInteractionsPerTicketPerHour must be 0-100");
  if (!Number.isInteger(data.aiCooldownSeconds) || data.aiCooldownSeconds < 0 || data.aiCooldownSeconds > 3600) throw new Error("aiCooldownSeconds must be 0-3600");
  if (data.maxBudgetPerTicketBrl !== null && (typeof data.maxBudgetPerTicketBrl !== "number" || !Number.isFinite(data.maxBudgetPerTicketBrl) || data.maxBudgetPerTicketBrl <= 0)) throw new Error("maxBudgetPerTicketBrl must be positive or null");
  if (!["pause", "escalate"].includes(data.rateLimitAction)) throw new Error("rateLimitAction must be pause or escalate");
  const resolvedChannel = channel ?? null;
  const updateData = { maxAiInteractionsPerTicketPerHour: data.maxAiInteractionsPerTicketPerHour, aiCooldownSeconds: data.aiCooldownSeconds, maxBudgetPerTicketBrl: data.maxBudgetPerTicketBrl, rateLimitAction: data.rateLimitAction };
  await prisma.$transaction(async (tx) => {
    const existing = await tx.aiConfig.findFirst({ where: { companyId, channel: resolvedChannel }, select: { id: true } });
    if (existing) { await tx.aiConfig.update({ where: { id: existing.id }, data: updateData }); }
    else { await tx.aiConfig.create({ data: { companyId, channel: resolvedChannel, persona: "Assistente virtual", ...updateData } }); }
  });
  await logAuditEvent({ userId: session.userId, action: "UPDATE", entity: "AiConfig", entityId: companyId, dataAfter: { ...data, channel: resolvedChannel, scope: "rate_limiting" } as unknown as Prisma.InputJsonValue, companyId });
}

export async function getTopConsumers(companyId: string, period: "7d" | "30d" | "90d" = "30d"): Promise<TopConsumerData[]> {
  await requireCompanyAccess(companyId);
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const tickets = await prisma.ticket.findMany({ where: { companyId, aiTotalCostBrl: { gt: 0 }, updatedAt: { gte: since } }, select: { id: true, subject: true, status: true, aiTotalCostBrl: true, client: { select: { name: true } }, _count: { select: { messages: { where: { isAiGenerated: true } } } } }, orderBy: { aiTotalCostBrl: "desc" }, take: 10 });
  return tickets.map((t) => ({ ticketId: t.id, subject: t.subject, clientName: t.client.name, totalCostBrl: Number(t.aiTotalCostBrl || 0), interactionCount: t._count.messages, status: t.status }));
}

export async function getTopClientConsumers(companyId: string, period: "7d" | "30d" | "90d" = "30d"): Promise<TopClientConsumerData[]> {
  await requireCompanyAccess(companyId);
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const results = await prisma.ticket.groupBy({ by: ["clientId"], where: { companyId, aiTotalCostBrl: { gt: 0 }, updatedAt: { gte: since } }, _sum: { aiTotalCostBrl: true }, _count: { id: true }, orderBy: { _sum: { aiTotalCostBrl: "desc" } }, take: 10 });
  if (results.length === 0) return [];
  const clientIds = results.map((r) => r.clientId);
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, cpfCnpj: true } });
  const clientMap = new Map(clients.map((c) => [c.id, c]));
  return results.map((r) => { const client = clientMap.get(r.clientId); return { clientId: r.clientId, clientName: client?.name || "Desconhecido", cpfCnpj: client?.cpfCnpj || "", ticketCount: r._count.id, totalCostBrl: Number(r._sum.aiTotalCostBrl || 0) }; });
}

export async function getRateLimitEvents(companyId: string, limit: number = 20): Promise<RateLimitEventData[]> {
  await requireCompanyAccess(companyId);
  const events = await prisma.aiRateLimitEvent.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(1, limit), 100) });
  return events.map((e) => ({ id: e.id, ticketId: e.ticketId, type: e.type, details: e.details as Record<string, unknown> | null, createdAt: e.createdAt.toISOString() }));
}
