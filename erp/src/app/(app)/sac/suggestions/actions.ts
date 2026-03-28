"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import type { ChannelType } from "@prisma/client";

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

export async function listSuggestions(
  companyId: string,
  filters?: SuggestionFilters,
): Promise<{ items: SuggestionListItem[]; total: number }> {
  await requireCompanyAccess(companyId);

  const where: Record<string, unknown> = { companyId };

  if (filters?.status && filters.status !== "ALL") {
    where.status = filters.status;
  }

  if (filters?.channel && (filters.channel as string) !== "ALL") {
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

export async function getSuggestionStats(companyId: string) {
  await requireCompanyAccess(companyId);

  const [pending, approved, rejected, edited] = await Promise.all([
    prisma.aiSuggestion.count({ where: { companyId, status: "PENDING" } }),
    prisma.aiSuggestion.count({ where: { companyId, status: "APPROVED" } }),
    prisma.aiSuggestion.count({ where: { companyId, status: "REJECTED" } }),
    prisma.aiSuggestion.count({ where: { companyId, status: "EDITED" } }),
  ]);

  return { pending, approved, rejected, edited };
}
