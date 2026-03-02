"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import type { Prisma, SlaType, TicketPriority } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlaConfigRow {
  id: string | null;
  type: SlaType;
  priority: TicketPriority | null;
  stage: string;
  deadlineMinutes: number;
  alertBeforeMinutes: number;
}

export interface SaveSlaConfigInput {
  type: SlaType;
  priority: TicketPriority | null;
  stage: string;
  deadlineMinutes: number;
  alertBeforeMinutes: number;
}

export interface BusinessHours {
  enabled: boolean;
  startHour: number;
  endHour: number;
  workDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
}

// ---------------------------------------------------------------------------
// Default SLA values
// ---------------------------------------------------------------------------

const DEFAULT_TICKET_SLAS: Omit<SlaConfigRow, "id">[] = [
  { type: "TICKET", priority: "HIGH", stage: "first_reply", deadlineMinutes: 30, alertBeforeMinutes: 15 },
  { type: "TICKET", priority: "HIGH", stage: "resolution", deadlineMinutes: 240, alertBeforeMinutes: 15 },
  { type: "TICKET", priority: "MEDIUM", stage: "first_reply", deadlineMinutes: 120, alertBeforeMinutes: 30 },
  { type: "TICKET", priority: "MEDIUM", stage: "resolution", deadlineMinutes: 1440, alertBeforeMinutes: 30 },
  { type: "TICKET", priority: "LOW", stage: "first_reply", deadlineMinutes: 480, alertBeforeMinutes: 60 },
  { type: "TICKET", priority: "LOW", stage: "resolution", deadlineMinutes: 2880, alertBeforeMinutes: 60 },
];

const DEFAULT_REFUND_SLAS: Omit<SlaConfigRow, "id">[] = [
  { type: "REFUND", priority: null, stage: "approval", deadlineMinutes: 240, alertBeforeMinutes: 60 },
  { type: "REFUND", priority: null, stage: "execution", deadlineMinutes: 1440, alertBeforeMinutes: 240 },
  { type: "REFUND", priority: null, stage: "total", deadlineMinutes: 2880, alertBeforeMinutes: 480 },
];

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  enabled: false,
  startHour: 8,
  endHour: 18,
  workDays: [1, 2, 3, 4, 5], // Mon-Fri
};

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function getSlaConfigs(companyId: string): Promise<SlaConfigRow[]> {
  await requireCompanyAccess(companyId);

  const configs = await prisma.slaConfig.findMany({
    where: { companyId },
    orderBy: [{ type: "asc" }, { priority: "asc" }, { stage: "asc" }],
  });

  if (configs.length === 0) {
    // Return defaults with null IDs to indicate they haven't been saved yet
    return [...DEFAULT_TICKET_SLAS, ...DEFAULT_REFUND_SLAS].map((c) => ({
      ...c,
      id: null,
    }));
  }

  return configs.map((c) => ({
    id: c.id,
    type: c.type,
    priority: c.priority,
    stage: c.stage,
    deadlineMinutes: c.deadlineMinutes,
    alertBeforeMinutes: c.alertBeforeMinutes,
  }));
}

export async function saveSlaConfigs(
  companyId: string,
  configs: SaveSlaConfigInput[]
): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);

  // Delete existing configs and recreate
  await prisma.$transaction(async (tx) => {
    await tx.slaConfig.deleteMany({ where: { companyId } });

    await tx.slaConfig.createMany({
      data: configs.map((c) => ({
        companyId,
        type: c.type,
        priority: c.priority,
        stage: c.stage,
        deadlineMinutes: c.deadlineMinutes,
        alertBeforeMinutes: c.alertBeforeMinutes,
      })),
    });
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "SlaConfig",
    entityId: companyId,
    dataAfter: configs as unknown as Prisma.InputJsonValue,
    companyId,
  });
}

export async function getBusinessHours(companyId: string): Promise<BusinessHours> {
  await requireCompanyAccess(companyId);

  // Business hours stored as a special SlaConfig with type TICKET, priority null, stage "business_hours"
  const config = await prisma.slaConfig.findFirst({
    where: { companyId, stage: "business_hours" },
  });

  if (!config) {
    return DEFAULT_BUSINESS_HOURS;
  }

  // deadlineMinutes encodes startHour * 100 + endHour
  // alertBeforeMinutes encodes workDays as bitmask
  const startHour = Math.floor(config.deadlineMinutes / 100);
  const endHour = config.deadlineMinutes % 100;
  const workDaysBitmask = config.alertBeforeMinutes;
  const workDays: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (workDaysBitmask & (1 << i)) workDays.push(i);
  }

  return {
    enabled: true,
    startHour,
    endHour,
    workDays,
  };
}

export async function saveBusinessHours(
  companyId: string,
  data: BusinessHours
): Promise<void> {
  const session = await requireAdmin();
  await requireCompanyAccess(companyId);

  if (!data.enabled) {
    // Remove business hours config if disabled
    await prisma.slaConfig.deleteMany({
      where: { companyId, stage: "business_hours" },
    });
  } else {
    // Encode into SlaConfig fields
    const deadlineMinutes = data.startHour * 100 + data.endHour;
    let workDaysBitmask = 0;
    for (const day of data.workDays) {
      workDaysBitmask |= (1 << day);
    }

    const existing = await prisma.slaConfig.findFirst({
      where: { companyId, stage: "business_hours" },
    });

    if (existing) {
      await prisma.slaConfig.update({
        where: { id: existing.id },
        data: { deadlineMinutes, alertBeforeMinutes: workDaysBitmask },
      });
    } else {
      await prisma.slaConfig.create({
        data: {
          companyId,
          type: "TICKET",
          priority: null,
          stage: "business_hours",
          deadlineMinutes,
          alertBeforeMinutes: workDaysBitmask,
        },
      });
    }
  }

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "BusinessHours",
    entityId: companyId,
    dataAfter: data as unknown as Prisma.InputJsonValue,
    companyId,
  });
}
