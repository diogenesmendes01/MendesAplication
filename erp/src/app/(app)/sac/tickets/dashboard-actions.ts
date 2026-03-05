"use server";

import { requireCompanyAccess } from "@/lib/rbac";
import { getCompanyKpis } from "@/lib/kpi-cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketDashboard {
  openCount: number;
  inProgressCount: number;
  waitingClientCount: number;
  resolvedTodayCount: number;
  slaBreachedCount: number;
  slaAtRiskCount: number;
  pendingRefundsCount: number;
  avgResponseTimeMinutes: number;
  ticketsByChannel: { channel: string; count: number }[];
  ticketsByPriority: { priority: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function getTicketDashboard(
  companyId: string
): Promise<TicketDashboard> {
  await requireCompanyAccess(companyId);

  const kpis = await getCompanyKpis(companyId);

  return {
    openCount: kpis.openCount,
    inProgressCount: kpis.inProgressCount,
    waitingClientCount: kpis.waitingClientCount,
    resolvedTodayCount: kpis.resolvedTodayCount,
    slaBreachedCount: kpis.slaBreachedCount,
    slaAtRiskCount: kpis.slaAtRiskCount,
    pendingRefundsCount: kpis.pendingRefundsCount,
    avgResponseTimeMinutes: kpis.avgResponseTimeMinutes,
    ticketsByChannel: kpis.ticketsByChannel,
    ticketsByPriority: kpis.ticketsByPriority,
  };
}
