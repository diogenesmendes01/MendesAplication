"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import type { ChannelType } from "@prisma/client";
import { withLogging } from "@/lib/with-logging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuggestionListItem {
  id: string;
  ticketId: string;
  ticketSubject: string;
  channel: ChannelType;
  status: string;
  confidence: number;
  suggestedResponse: string;
  suggestedActions: unknown[];
  analysis: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
  reviewerName: string | null;
  editedResponse: string | null;
  rejectionReason: string | null;
}

export interface SuggestionFilters {
  status?: string;
  channel?: ChannelType;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function _listSuggestions(
  companyId: string,
  filters?: SuggestionFilters,
): Promise<{ items: SuggestionListItem[]; total: number }> {
  await requireCompanyAccess(companyId);

  const where: Record<string, unknown> = { companyId };

  if (filters?.status && filters.status !== "ALL") {
    where.status = filters.status;
  }

  if (filters?.channel && String(filters.channel) !== "ALL") {
    where.channel = filters.channel;
  }

  const limit = Math.min(filters?.limit ?? 25, 100);
  const offset = filters?.offset ?? 0;

  const [items, total] = await Promise.all([
    prisma.aiSuggestion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        ticket: { select: { id: true, subject: true } },
        reviewer: { select: { id: true, name: true } },
      },
      take: limit,
      skip: offset,
    }),
    prisma.aiSuggestion.count({ where }),
  ]);

  return {
    items: items.map((s) => ({
      id: s.id,
      ticketId: s.ticket.id,
      ticketSubject: s.ticket.subject,
      channel: s.channel,
      status: s.status,
      confidence: s.confidence,
      suggestedResponse: s.suggestedResponse,
      suggestedActions: s.suggestedActions as unknown[],
      analysis: s.analysis as Record<string, unknown>,
      createdAt: s.createdAt.toISOString(),
      reviewedAt: s.reviewedAt?.toISOString() ?? null,
      reviewerName: s.reviewer?.name ?? null,
      editedResponse: s.editedResponse,
      rejectionReason: s.rejectionReason,
    })),
    total,
  };
}

async function _getSuggestionStats(companyId: string) {
  await requireCompanyAccess(companyId);

  const grouped = await prisma.aiSuggestion.groupBy({
    by: ["status"],
    where: { companyId },
    _count: true,
  });

  const counts: Record<string, number> = {};
  for (const g of grouped) {
    counts[g.status] = g._count;
  }

  return {
    pending: counts["PENDING"] ?? 0,
    approved: counts["APPROVED"] ?? 0,
    rejected: counts["REJECTED"] ?? 0,
    edited: counts["EDITED"] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
const _wrapped_listSuggestions = withLogging('sac.suggestions.listSuggestions', _listSuggestions);
export async function listSuggestions(...args: Parameters<typeof _listSuggestions>) { return _wrapped_listSuggestions(...args); }
const _wrapped_getSuggestionStats = withLogging('sac.suggestions.getSuggestionStats', _getSuggestionStats);
export async function getSuggestionStats(...args: Parameters<typeof _getSuggestionStats>) { return _wrapped_getSuggestionStats(...args); }
