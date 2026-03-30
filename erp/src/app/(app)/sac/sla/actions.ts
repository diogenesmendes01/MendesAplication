"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import type { Prisma, SlaType, TicketPriority, ChannelType } from "@prisma/client";
import { withLogging } from "@/lib/with-logging";

export interface SlaPolicyRow {
  id: string;
  type: SlaType;
  priority: TicketPriority | null;
  stage: string;
  channelType: ChannelType | null;
  deadlineMinutes: number;
  alertBeforeMinutes: number;
  autoEscalate: boolean;
  autoPriorityBump: boolean;
  escalateToRole: string | null;
  businessHoursOnly: boolean;
  businessHoursStart: number | null;
  businessHoursEnd: number | null;
}

export interface CreateSlaPolicyInput {
  type: SlaType;
  priority: TicketPriority | null;
  stage: string;
  channelType: ChannelType | null;
  deadlineMinutes: number;
  alertBeforeMinutes: number;
  autoEscalate?: boolean;
  autoPriorityBump?: boolean;
  escalateToRole?: string | null;
  businessHoursOnly?: boolean;
  businessHoursStart?: number | null;
  businessHoursEnd?: number | null;
}

export interface UpdateSlaPolicyInput extends CreateSlaPolicyInput {
  id: string;
}

export interface SlaDashboardResult {
  atRiskTickets: {
    id: string; subject: string; priority: string;
    channelType: string | null; minutesLeft: number; stage: string;
  }[];
  recentViolations: {
    id: string; ticketId: string; stage: string; channel: string;
    priority: string; deadlineMinutes: number; actualMinutes: number; breachedAt: string;
  }[];
  compliancePercent: number;
  breachedCount: number;
  atRiskCount: number;
}

async function _listSlaPolicies(companyId: string): Promise<SlaPolicyRow[]> {
  await requireCompanyAccess(companyId);
  const configs = await prisma.slaConfig.findMany({
    where: { companyId },
    orderBy: [{ type: "asc" }, { channelType: "asc" }, { priority: "asc" }, { stage: "asc" }],
  });
  return configs.map((c) => ({
    id: c.id, type: c.type, priority: c.priority, stage: c.stage,
    channelType: c.channelType, deadlineMinutes: c.deadlineMinutes,
    alertBeforeMinutes: c.alertBeforeMinutes, autoEscalate: c.autoEscalate,
    autoPriorityBump: c.autoPriorityBump, escalateToRole: c.escalateToRole,
    businessHoursOnly: c.businessHoursOnly, businessHoursStart: c.businessHoursStart,
    businessHoursEnd: c.businessHoursEnd,
  }));
}

async function _createSlaPolicy(companyId: string, input: CreateSlaPolicyInput): Promise<SlaPolicyRow> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);
  const created = await prisma.slaConfig.create({
    data: {
      companyId, type: input.type, priority: input.priority, stage: input.stage,
      channelType: input.channelType, deadlineMinutes: input.deadlineMinutes,
      alertBeforeMinutes: input.alertBeforeMinutes,
      autoEscalate: input.autoEscalate ?? true, autoPriorityBump: input.autoPriorityBump ?? true,
      escalateToRole: input.escalateToRole ?? null, businessHoursOnly: input.businessHoursOnly ?? false,
      businessHoursStart: input.businessHoursStart ?? 8, businessHoursEnd: input.businessHoursEnd ?? 18,
    },
  });
  await logAuditEvent({
    userId: session.userId, action: "CREATE", entity: "SlaConfig",
    entityId: created.id, dataAfter: input as unknown as Prisma.InputJsonValue, companyId,
  });
  return {
    id: created.id, type: created.type, priority: created.priority, stage: created.stage,
    channelType: created.channelType, deadlineMinutes: created.deadlineMinutes,
    alertBeforeMinutes: created.alertBeforeMinutes, autoEscalate: created.autoEscalate,
    autoPriorityBump: created.autoPriorityBump, escalateToRole: created.escalateToRole,
    businessHoursOnly: created.businessHoursOnly, businessHoursStart: created.businessHoursStart,
    businessHoursEnd: created.businessHoursEnd,
  };
}

async function _updateSlaPolicy(companyId: string, input: UpdateSlaPolicyInput): Promise<SlaPolicyRow> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);
  const updated = await prisma.slaConfig.update({
    where: { id: input.id },
    data: {
      priority: input.priority, stage: input.stage, channelType: input.channelType,
      deadlineMinutes: input.deadlineMinutes, alertBeforeMinutes: input.alertBeforeMinutes,
      autoEscalate: input.autoEscalate ?? true, autoPriorityBump: input.autoPriorityBump ?? true,
      escalateToRole: input.escalateToRole ?? null, businessHoursOnly: input.businessHoursOnly ?? false,
      businessHoursStart: input.businessHoursStart ?? 8, businessHoursEnd: input.businessHoursEnd ?? 18,
    },
  });
  await logAuditEvent({
    userId: session.userId, action: "UPDATE", entity: "SlaConfig",
    entityId: input.id, dataAfter: input as unknown as Prisma.InputJsonValue, companyId,
  });
  return {
    id: updated.id, type: updated.type, priority: updated.priority, stage: updated.stage,
    channelType: updated.channelType, deadlineMinutes: updated.deadlineMinutes,
    alertBeforeMinutes: updated.alertBeforeMinutes, autoEscalate: updated.autoEscalate,
    autoPriorityBump: updated.autoPriorityBump, escalateToRole: updated.escalateToRole,
    businessHoursOnly: updated.businessHoursOnly, businessHoursStart: updated.businessHoursStart,
    businessHoursEnd: updated.businessHoursEnd,
  };
}

async function _deleteSlaPolicy(companyId: string, policyId: string): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);
  await prisma.slaConfig.delete({ where: { id: policyId } });
  await logAuditEvent({ userId: session.userId, action: "DELETE", entity: "SlaConfig", entityId: policyId, companyId });
}

async function _getSlaDashboard(companyId: string): Promise<SlaDashboardResult> {
  await requireCompanyAccess(companyId);

  const atRiskRaw = await prisma.ticket.findMany({
    where: { companyId, slaAtRisk: true, slaBreached: false, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } },
    include: { channel: { select: { type: true } } },
    orderBy: { slaFirstReply: "asc" },
    take: 20,
  });

  const now = new Date();
  const atRiskTickets = atRiskRaw.map((t) => {
    const frLeft = t.slaFirstReply && !t.slaFirstReplyAt ? Math.max(0, Math.round((t.slaFirstReply.getTime() - now.getTime()) / 60000)) : null;
    const resLeft = t.slaResolution && !t.slaResolvedAt ? Math.max(0, Math.round((t.slaResolution.getTime() - now.getTime()) / 60000)) : null;
    const minutesLeft = Math.min(frLeft ?? Infinity, resLeft ?? Infinity);
    const stage = frLeft !== null && (resLeft === null || frLeft <= resLeft) ? "first_reply" : "resolution";
    return { id: t.id, subject: t.subject, priority: t.priority, channelType: t.channel?.type ?? null, minutesLeft: minutesLeft === Infinity ? 0 : minutesLeft, stage };
  });

  const recentViolations = await prisma.slaViolation.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 10 });

  const [breachedCount, atRiskCount, totalRecent] = await Promise.all([
    prisma.ticket.count({ where: { companyId, slaBreached: true, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } } }),
    prisma.ticket.count({ where: { companyId, slaAtRisk: true, slaBreached: false, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } } }),
    prisma.ticket.count({ where: { companyId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, status: { not: "MERGED" } } }),
  ]);

  const breachedLast30 = await prisma.ticket.count({
    where: { companyId, slaBreached: true, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
  });

  const compliancePercent = totalRecent > 0 ? Math.round(((totalRecent - breachedLast30) / totalRecent) * 100) : 100;

  return {
    atRiskTickets,
    recentViolations: recentViolations.map((v) => ({
      id: v.id, ticketId: v.ticketId, stage: v.stage, channel: v.channel,
      priority: v.priority, deadlineMinutes: v.deadlineMinutes,
      actualMinutes: v.actualMinutes, breachedAt: v.breachedAt.toISOString(),
    })),
    compliancePercent, breachedCount, atRiskCount,
  };
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
export const listSlaPolicies = withLogging('sac.sla.listSlaPolicies', _listSlaPolicies);
export const createSlaPolicy = withLogging('sac.sla.createSlaPolicy', _createSlaPolicy);
export const updateSlaPolicy = withLogging('sac.sla.updateSlaPolicy', _updateSlaPolicy);
export const deleteSlaPolicy = withLogging('sac.sla.deleteSlaPolicy', _deleteSlaPolicy);
export const getSlaDashboard = withLogging('sac.sla.getSlaDashboard', _getSlaDashboard);
