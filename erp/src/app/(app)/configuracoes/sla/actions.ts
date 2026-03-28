"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import type { Prisma, SlaType, TicketPriority, ChannelType } from "@prisma/client";

export interface SlaConfigRow {
  id: string | null;
  type: SlaType;
  priority: TicketPriority | null;
  stage: string;
  channelType: ChannelType | null;
  deadlineMinutes: number;
  alertBeforeMinutes: number;
  autoEscalate: boolean;
  autoPriorityBump: boolean;
  escalateToRole: string | null;
}

export interface SaveSlaConfigInput {
  type: SlaType;
  priority: TicketPriority | null;
  stage: string;
  channelType: ChannelType | null;
  deadlineMinutes: number;
  alertBeforeMinutes: number;
  autoEscalate?: boolean;
  autoPriorityBump?: boolean;
  escalateToRole?: string | null;
}

export interface BusinessHours {
  enabled: boolean;
  startHour: number;
  endHour: number;
  workDays: number[];
}

const DEFAULT_TICKET_SLAS: Omit<SlaConfigRow, "id">[] = [
  { type: "TICKET", priority: "HIGH", stage: "first_reply", channelType: null, deadlineMinutes: 30, alertBeforeMinutes: 15, autoEscalate: true, autoPriorityBump: true, escalateToRole: null },
  { type: "TICKET", priority: "HIGH", stage: "resolution", channelType: null, deadlineMinutes: 240, alertBeforeMinutes: 15, autoEscalate: true, autoPriorityBump: true, escalateToRole: null },
  { type: "TICKET", priority: "MEDIUM", stage: "first_reply", channelType: null, deadlineMinutes: 120, alertBeforeMinutes: 30, autoEscalate: true, autoPriorityBump: true, escalateToRole: null },
  { type: "TICKET", priority: "MEDIUM", stage: "resolution", channelType: null, deadlineMinutes: 1440, alertBeforeMinutes: 30, autoEscalate: true, autoPriorityBump: true, escalateToRole: null },
  { type: "TICKET", priority: "LOW", stage: "first_reply", channelType: null, deadlineMinutes: 480, alertBeforeMinutes: 60, autoEscalate: true, autoPriorityBump: true, escalateToRole: null },
  { type: "TICKET", priority: "LOW", stage: "resolution", channelType: null, deadlineMinutes: 2880, alertBeforeMinutes: 60, autoEscalate: true, autoPriorityBump: true, escalateToRole: null },
];

const DEFAULT_REFUND_SLAS: Omit<SlaConfigRow, "id">[] = [
  { type: "REFUND", priority: null, stage: "approval", channelType: null, deadlineMinutes: 240, alertBeforeMinutes: 60, autoEscalate: true, autoPriorityBump: false, escalateToRole: null },
  { type: "REFUND", priority: null, stage: "execution", channelType: null, deadlineMinutes: 1440, alertBeforeMinutes: 240, autoEscalate: true, autoPriorityBump: false, escalateToRole: null },
  { type: "REFUND", priority: null, stage: "total", channelType: null, deadlineMinutes: 2880, alertBeforeMinutes: 480, autoEscalate: true, autoPriorityBump: false, escalateToRole: null },
];

export async function getSlaConfigs(companyId: string): Promise<SlaConfigRow[]> {
  await requireCompanyAccess(companyId);
  const configs = await prisma.slaConfig.findMany({
    where: { companyId },
    orderBy: [{ type: "asc" }, { channelType: "asc" }, { priority: "asc" }, { stage: "asc" }],
  });
  if (configs.length === 0) return [...DEFAULT_TICKET_SLAS, ...DEFAULT_REFUND_SLAS].map((c) => ({ ...c, id: null }));
  return configs.map((c) => ({
    id: c.id, type: c.type, priority: c.priority, stage: c.stage, channelType: c.channelType,
    deadlineMinutes: c.deadlineMinutes, alertBeforeMinutes: c.alertBeforeMinutes,
    autoEscalate: c.autoEscalate, autoPriorityBump: c.autoPriorityBump, escalateToRole: c.escalateToRole,
  }));
}

export async function saveSlaConfigs(companyId: string, configs: SaveSlaConfigInput[]): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);
  await prisma.$transaction(async (tx) => {
    await tx.slaConfig.deleteMany({ where: { companyId, stage: { not: "business_hours" } } });
    await tx.slaConfig.createMany({
      data: configs.map((c) => ({
        companyId, type: c.type, priority: c.priority, stage: c.stage,
        channelType: c.channelType ?? null, deadlineMinutes: c.deadlineMinutes,
        alertBeforeMinutes: c.alertBeforeMinutes, autoEscalate: c.autoEscalate ?? true,
        autoPriorityBump: c.autoPriorityBump ?? true, escalateToRole: c.escalateToRole ?? null,
      })),
    });
  });
  await logAuditEvent({ userId: session.userId, action: "UPDATE", entity: "SlaConfig", entityId: companyId, dataAfter: configs as unknown as Prisma.InputJsonValue, companyId });
}

export async function getBusinessHours(companyId: string): Promise<BusinessHours> {
  await requireCompanyAccess(companyId);
  const config = await prisma.slaConfig.findFirst({ where: { companyId, stage: "business_hours" } });
  if (!config) return { enabled: false, startHour: 8, endHour: 18, workDays: [1, 2, 3, 4, 5] };
  const startHour = Math.floor(config.deadlineMinutes / 100);
  const endHour = config.deadlineMinutes % 100;
  const bitmask = config.alertBeforeMinutes;
  const workDays: number[] = [];
  for (let i = 0; i < 7; i++) { if (bitmask & (1 << i)) workDays.push(i); }
  return { enabled: true, startHour, endHour, workDays };
}

export async function saveBusinessHours(companyId: string, data: BusinessHours): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);
  if (!data.enabled) {
    await prisma.slaConfig.deleteMany({ where: { companyId, stage: "business_hours" } });
  } else {
    const deadlineMinutes = data.startHour * 100 + data.endHour;
    let bitmask = 0;
    for (const day of data.workDays) bitmask |= (1 << day);
    const existing = await prisma.slaConfig.findFirst({ where: { companyId, stage: "business_hours" } });
    if (existing) {
      await prisma.slaConfig.update({ where: { id: existing.id }, data: { deadlineMinutes, alertBeforeMinutes: bitmask } });
    } else {
      await prisma.slaConfig.create({ data: { companyId, type: "TICKET", priority: null, stage: "business_hours", deadlineMinutes, alertBeforeMinutes: bitmask } });
    }
  }
  await logAuditEvent({ userId: session.userId, action: "UPDATE", entity: "BusinessHours", entityId: companyId, dataAfter: data as unknown as Prisma.InputJsonValue, companyId });
}
