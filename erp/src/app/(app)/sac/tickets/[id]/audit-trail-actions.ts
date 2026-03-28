"use server";

import { requireCompanyAccess } from "@/lib/rbac";
import {
  getAuditTrail,
  getAuditEntry,
  exportAuditTrailCSV,
  exportAuditTrailJSON,
} from "@/lib/ai/audit-trail";

export type AuditTrailRecord = Awaited<ReturnType<typeof getAuditTrail>>[number];

export async function fetchAuditTrail(ticketId: string, companyId: string) {
  await requireCompanyAccess(companyId);
  return getAuditTrail(ticketId, companyId);
}

export async function fetchAuditEntry(id: string, companyId: string) {
  await requireCompanyAccess(companyId);
  return getAuditEntry(id, companyId);
}

export async function exportAuditTrail(
  ticketId: string,
  companyId: string,
  format: "csv" | "json",
): Promise<string> {
  await requireCompanyAccess(companyId);
  if (format === "csv") {
    return exportAuditTrailCSV(ticketId, companyId);
  }
  return exportAuditTrailJSON(ticketId, companyId);
}
