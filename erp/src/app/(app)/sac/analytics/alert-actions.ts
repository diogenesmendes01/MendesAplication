"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { withLogging } from "@/lib/with-logging";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiAlertInput {
  companyId: string;
  metricType: string;
  threshold: number;
  operator?: string;
  enabled?: boolean;
}

export interface AiAlertRow {
  id: string;
  companyId: string;
  metricType: string;
  threshold: number;
  operator: string;
  enabled: boolean;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// NOTE: METRIC_TYPES (plain const array) moved to ./alert-actions.types.ts
// to avoid "use server" export constraint (Next.js only allows async functions).

// ─── List ─────────────────────────────────────────────────────────────────────

async function _listAlerts(companyId: string): Promise<AiAlertRow[]> {
  await requireCompanyAccess(companyId);

  return prisma.aiAlert.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
  });
}

// ─── Upsert (create or update by companyId + metricType) ──────────────────────

async function _upsertAlert(input: AiAlertInput): Promise<AiAlertRow> {
  await requireCompanyAccess(input.companyId);

  const data = {
    threshold: input.threshold,
    operator: input.operator ?? "gt",
    enabled: input.enabled ?? true,
  };

  const result = await prisma.aiAlert.upsert({
    where: {
      companyId_metricType: {
        companyId: input.companyId,
        metricType: input.metricType,
      },
    },
    create: {
      companyId: input.companyId,
      metricType: input.metricType,
      ...data,
    },
    update: data,
  });

  revalidatePath("/sac/analytics");
  return result;
}

// ─── Toggle Enabled ───────────────────────────────────────────────────────────

async function _toggleAlert(
  id: string,
  enabled: boolean,
): Promise<AiAlertRow> {
  // Fetch the alert first to verify tenant ownership
  const alert = await prisma.aiAlert.findUniqueOrThrow({ where: { id } });
  await requireCompanyAccess(alert.companyId);

  const result = await prisma.aiAlert.update({
    where: { id },
    data: { enabled },
  });
  revalidatePath("/sac/analytics");
  return result;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function _deleteAlert(id: string): Promise<void> {
  // Fetch the alert first to verify tenant ownership
  const alert = await prisma.aiAlert.findUniqueOrThrow({ where: { id } });
  await requireCompanyAccess(alert.companyId);

  await prisma.aiAlert.delete({ where: { id } });
  revalidatePath("/sac/analytics");
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
export const listAlerts = withLogging('sac.alerts.listAlerts', _listAlerts);
export const upsertAlert = withLogging('sac.alerts.upsertAlert', _upsertAlert);
export const toggleAlert = withLogging('sac.alerts.toggleAlert', _toggleAlert);
export const deleteAlert = withLogging('sac.alerts.deleteAlert', _deleteAlert);
