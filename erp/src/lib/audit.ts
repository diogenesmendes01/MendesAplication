"use server";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGOUT"
  | "STATUS_CHANGE";

export interface AuditEventParams {
  userId: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  dataBefore?: Prisma.InputJsonValue | null;
  dataAfter?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  companyId?: string | null;
}

// ---------------------------------------------------------------------------
// Audit Logging
// ---------------------------------------------------------------------------

/**
 * Log an audit event. Insert-only — no update or delete operations exist.
 * This function is fire-and-forget: errors are logged to console but never thrown
 * to avoid disrupting the main operation.
 */
export async function logAuditEvent(params: AuditEventParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        dataBefore: params.dataBefore ?? undefined,
        dataAfter: params.dataAfter ?? undefined,
        ipAddress: params.ipAddress ?? null,
        companyId: params.companyId ?? null,
      },
    });
  } catch (error) {
    logger.error("Failed to log audit event:", error);
  }
}
