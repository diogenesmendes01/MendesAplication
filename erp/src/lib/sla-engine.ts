/**
 * SLA Engine — Phase 1
 *
 * Core logic for SLA assignment, violation detection, escalation, and status.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sseBus } from "@/lib/sse";
import { calculateSlaDeadline, type BusinessHours } from "@/lib/sla";
import type {
  ChannelType,
  TicketPriority,
  SlaConfig,
  Ticket,
  Channel,
} from "@prisma/client";

export interface ResolvedSlaConfig {
  id: string | null;
  stage: string;
  deadlineMinutes: number;
  alertBeforeMinutes: number;
  autoEscalate: boolean;
  autoPriorityBump: boolean;
  escalateToRole: string | null;
  businessHoursOnly: boolean;
  businessHoursStart: number;
  businessHoursEnd: number;
}

export type SlaEngineStatus = "ok" | "at_risk" | "breached";

export interface SlaStatusResult {
  ticketId: string;
  firstResponse: {
    deadline: Date | null;
    respondedAt: Date | null;
    breached: boolean;
    minutesRemaining: number | null;
    percentConsumed: number;
    status: SlaEngineStatus;
  };
  resolution: {
    deadline: Date | null;
    respondedAt: Date | null;
    breached: boolean;
    minutesRemaining: number | null;
    percentConsumed: number;
    status: SlaEngineStatus;
  };
  overallStatus: SlaEngineStatus;
}

type TicketWithChannel = Ticket & { channel: Channel | null };

/**
 * Resolve best SLA config: exact > channel-only > priority-only > global > default
 */
export async function resolveSlaConfig(
  companyId: string,
  channelType: ChannelType | null,
  priority: TicketPriority,
  stage: string
): Promise<ResolvedSlaConfig> {
  const configs = await prisma.slaConfig.findMany({
    where: { companyId, type: "TICKET", stage },
  });

  const exact = configs.find((c) => c.channelType === channelType && c.priority === priority);
  if (exact) return toResolved(exact);

  const byChannel = configs.find((c) => c.channelType === channelType && c.priority === null);
  if (byChannel) return toResolved(byChannel);

  const byPriority = configs.find((c) => c.channelType === null && c.priority === priority);
  if (byPriority) return toResolved(byPriority);

  const global = configs.find((c) => c.channelType === null && c.priority === null);
  if (global) return toResolved(global);

  const defaults: Record<string, number> = { first_reply: 120, resolution: 1440 };
  return {
    id: null, stage, deadlineMinutes: defaults[stage] ?? 120,
    alertBeforeMinutes: 30, autoEscalate: true, autoPriorityBump: true,
    escalateToRole: "ADMIN", businessHoursOnly: false,
    businessHoursStart: 8, businessHoursEnd: 18,
  };
}

function toResolved(config: SlaConfig): ResolvedSlaConfig {
  return {
    id: config.id, stage: config.stage,
    deadlineMinutes: config.deadlineMinutes,
    alertBeforeMinutes: config.alertBeforeMinutes,
    autoEscalate: config.autoEscalate,
    autoPriorityBump: config.autoPriorityBump,
    escalateToRole: config.escalateToRole,
    businessHoursOnly: config.businessHoursOnly,
    businessHoursStart: config.businessHoursStart ?? 8,
    businessHoursEnd: config.businessHoursEnd ?? 18,
  };
}

function getBusinessHours(config: ResolvedSlaConfig): BusinessHours | undefined {
  if (!config.businessHoursOnly) return undefined;
  return { enabled: true, startHour: config.businessHoursStart, endHour: config.businessHoursEnd, workDays: [1, 2, 3, 4, 5] };
}

export async function assignSlaToTicket(
  ticketId: string, companyId: string, channelType: ChannelType | null,
  priority: TicketPriority, createdAt: Date = new Date()
): Promise<void> {
  const [frCfg, resCfg] = await Promise.all([
    resolveSlaConfig(companyId, channelType, priority, "first_reply"),
    resolveSlaConfig(companyId, channelType, priority, "resolution"),
  ]);

  const firstReplyDeadline = calculateSlaDeadline(createdAt, frCfg.deadlineMinutes, getBusinessHours(frCfg));
  const resolutionDeadline = calculateSlaDeadline(createdAt, resCfg.deadlineMinutes, getBusinessHours(resCfg));

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { slaFirstReply: firstReplyDeadline, slaResolution: resolutionDeadline },
  });

  logger.info(`[sla-engine] Assigned SLA to ticket ${ticketId}: firstReply=${frCfg.deadlineMinutes}min, resolution=${resCfg.deadlineMinutes}min`);
}

export async function markFirstResponse(ticketId: string): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { slaFirstReply: true, slaFirstReplyAt: true, slaBreached: true },
  });
  if (!ticket || ticket.slaFirstReplyAt) return;

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { slaFirstReplyAt: new Date() },
  });
  logger.info(`[sla-engine] First response marked for ticket ${ticketId}`);
}

export async function markResolved(ticketId: string): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { slaResolvedAt: true },
  });
  if (!ticket || ticket.slaResolvedAt) return;

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { slaResolvedAt: new Date(), slaAtRisk: false },
  });
  logger.info(`[sla-engine] Resolution marked for ticket ${ticketId}`);
}

export async function getTicketSlaStatus(ticketId: string): Promise<SlaStatusResult | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, slaFirstReply: true, slaResolution: true,
      slaFirstReplyAt: true, slaResolvedAt: true,
      slaBreached: true, slaAtRisk: true, createdAt: true,
    },
  });
  if (!ticket) return null;

  const now = new Date();
  const firstResponse = computeStageStatus(ticket.createdAt, ticket.slaFirstReply, ticket.slaFirstReplyAt, now);
  const resolution = computeStageStatus(ticket.createdAt, ticket.slaResolution, ticket.slaResolvedAt, now);

  let overallStatus: SlaEngineStatus = "ok";
  if (firstResponse.status === "breached" || resolution.status === "breached") overallStatus = "breached";
  else if (firstResponse.status === "at_risk" || resolution.status === "at_risk") overallStatus = "at_risk";

  return { ticketId: ticket.id, firstResponse, resolution, overallStatus };
}

function computeStageStatus(
  createdAt: Date, deadline: Date | null, completedAt: Date | null, now: Date
): {
  deadline: Date | null; respondedAt: Date | null; breached: boolean;
  minutesRemaining: number | null; percentConsumed: number; status: SlaEngineStatus;
} {
  if (!deadline) {
    return { deadline: null, respondedAt: completedAt, breached: false, minutesRemaining: null, percentConsumed: 0, status: "ok" };
  }

  const totalMs = deadline.getTime() - createdAt.getTime();
  const effectiveEnd = completedAt ?? now;
  const elapsedMs = effectiveEnd.getTime() - createdAt.getTime();
  const percentConsumed = totalMs > 0 ? Math.min(Math.round((elapsedMs / totalMs) * 100), 100) : 100;
  const breached = completedAt ? completedAt > deadline : now > deadline;
  const minutesRemaining = completedAt ? null : Math.max(0, Math.round((deadline.getTime() - now.getTime()) / 60000));

  let status: SlaEngineStatus = "ok";
  if (breached) status = "breached";
  else if (percentConsumed >= 80) status = "at_risk";

  return { deadline, respondedAt: completedAt, breached, minutesRemaining, percentConsumed, status };
}

export async function checkSlaViolations(): Promise<{ breached: number; atRisk: number }> {
  const now = new Date();
  let breachedCount = 0;
  let atRiskCount = 0;

  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
      OR: [
        { slaFirstReply: { not: null }, slaFirstReplyAt: null },
        { slaResolution: { not: null }, slaResolvedAt: null },
      ],
    },
    include: { channel: { select: { type: true } } },
  });

  for (const ticket of tickets) {
    const channelType = ticket.channel?.type ?? null;

    if (ticket.slaFirstReply && !ticket.slaFirstReplyAt) {
      if (now >= ticket.slaFirstReply && !ticket.slaBreached) {
        const config = await resolveSlaConfig(ticket.companyId, channelType, ticket.priority, "first_reply");
        await handleSlaBreach(ticket as TicketWithChannel, "first_reply", config, now);
        breachedCount++;
      } else if (!ticket.slaBreached) {
        const config = await resolveSlaConfig(ticket.companyId, channelType, ticket.priority, "first_reply");
        const alertTime = new Date(ticket.slaFirstReply.getTime() - config.alertBeforeMinutes * 60000);
        if (now >= alertTime && !ticket.slaAtRisk) {
          await handleSlaAtRisk(ticket as TicketWithChannel, "first_reply");
          atRiskCount++;
        }
      }
    }

    if (ticket.slaResolution && !ticket.slaResolvedAt && !ticket.slaBreached) {
      if (now >= ticket.slaResolution) {
        const config = await resolveSlaConfig(ticket.companyId, channelType, ticket.priority, "resolution");
        await handleSlaBreach(ticket as TicketWithChannel, "resolution", config, now);
        breachedCount++;
      } else {
        const config = await resolveSlaConfig(ticket.companyId, channelType, ticket.priority, "resolution");
        const alertTime = new Date(ticket.slaResolution.getTime() - config.alertBeforeMinutes * 60000);
        if (now >= alertTime && !ticket.slaAtRisk) {
          await handleSlaAtRisk(ticket as TicketWithChannel, "resolution");
          atRiskCount++;
        }
      }
    }
  }

  return { breached: breachedCount, atRisk: atRiskCount };
}

async function handleSlaBreach(
  ticket: TicketWithChannel, stage: string, config: ResolvedSlaConfig, now: Date
): Promise<void> {
  const actualMinutes = Math.round((now.getTime() - ticket.createdAt.getTime()) / 60000);
  let escalatedTo: string | null = null;
  const previousAssignee = ticket.assigneeId;

  if (config.autoEscalate) {
    escalatedTo = await resolveEscalationTarget(ticket.companyId, config.escalateToRole);
  }

  const newPriority = config.autoPriorityBump ? bumpPriority(ticket.priority) : ticket.priority;

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      slaBreached: true, slaAtRisk: false,
      slaEscalatedAt: config.autoEscalate ? now : undefined,
      priority: newPriority,
      ...(escalatedTo && escalatedTo !== ticket.assigneeId ? { assigneeId: escalatedTo } : {}),
    },
  });

  await prisma.slaViolation.create({
    data: {
      ticketId: ticket.id, companyId: ticket.companyId, stage,
      channel: ticket.channel?.type ?? "EMAIL", priority: ticket.priority,
      deadlineMinutes: config.deadlineMinutes, actualMinutes, breachedAt: now,
      escalatedTo, previousAssignee,
    },
  });

  const stageLabel = stage === "first_reply" ? "primeira resposta" : "resolução";
  const escalationNote = escalatedTo ? "Ticket reatribuído para gestor." : "Nenhuma escalação automática configurada.";

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      content: `[SLA] Prazo de ${stageLabel} estourado (${config.deadlineMinutes}min). ${escalationNote}`,
      isInternal: true, direction: "OUTBOUND", origin: "SYSTEM",
    },
  });

  sseBus.publish(`sac:${ticket.companyId}`, "sla-breach", {
    ticketId: ticket.id, stage, escalatedTo, priority: newPriority,
  });

  await prisma.auditLog.create({
    data: {
      userId: "SYSTEM", action: "SLA_BREACHED", entity: "Ticket",
      entityId: ticket.id, companyId: ticket.companyId,
      dataAfter: { stage, deadlineMinutes: config.deadlineMinutes, actualMinutes, escalatedTo, newPriority },
    },
  });

  logger.warn(`[sla-engine] SLA breach: ticket=${ticket.id} stage=${stage} deadline=${config.deadlineMinutes}min actual=${actualMinutes}min`);
}

async function handleSlaAtRisk(ticket: TicketWithChannel, stage: string): Promise<void> {
  await prisma.ticket.update({ where: { id: ticket.id }, data: { slaAtRisk: true } });

  const deadline = stage === "first_reply" ? ticket.slaFirstReply : ticket.slaResolution;
  const minutesLeft = deadline ? Math.max(0, Math.round((deadline.getTime() - Date.now()) / 60000)) : 0;

  sseBus.publish(`sac:${ticket.companyId}`, "sla-at-risk", { ticketId: ticket.id, stage, minutesLeft });

  await prisma.auditLog.create({
    data: {
      userId: "SYSTEM", action: "SLA_AT_RISK", entity: "Ticket",
      entityId: ticket.id, companyId: ticket.companyId,
      dataAfter: { stage, minutesLeft },
    },
  });

  logger.info(`[sla-engine] SLA at risk: ticket=${ticket.id} stage=${stage} minutesLeft=${minutesLeft}`);
}

async function resolveEscalationTarget(companyId: string, escalateToRole: string | null): Promise<string | null> {
  const role = escalateToRole ?? "ADMIN";
  if (role.length > 10 && !["ADMIN", "MANAGER"].includes(role)) return role;

  const userCompany = await prisma.userCompany.findFirst({
    where: { companyId, user: { role: role as "ADMIN" | "MANAGER", status: "ACTIVE" } },
    select: { userId: true },
  });
  return userCompany?.userId ?? null;
}

function bumpPriority(current: TicketPriority): TicketPriority {
  if (current === "LOW") return "MEDIUM";
  if (current === "MEDIUM") return "HIGH";
  return "HIGH";
}
