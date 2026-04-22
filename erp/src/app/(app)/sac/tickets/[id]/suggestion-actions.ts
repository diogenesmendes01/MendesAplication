"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import {
  approveSuggestion,
  rejectSuggestion,
} from "@/lib/ai/suggestion-mode";
import type { ChannelType, AiSuggestionStatus } from "@prisma/client";

// ─── Typed return for getSuggestions ────────────────────────────────────────

export interface SuggestionRecord {
  id: string;
  ticketId: string;
  companyId: string;
  channel: ChannelType;
  analysis: Record<string, unknown>;
  suggestedResponse: string;
  suggestedSubject: string | null;
  suggestedActions: Array<{ toolName: string; args: Record<string, unknown>; order: number }>;
  raPrivateMessage: string | null;
  raPublicMessage: string | null;
  raDetectedType: string | null;
  raSuggestModeration: boolean;
  status: AiSuggestionStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  editedResponse: string | null;
  editedSubject: string | null;
  rejectionReason: string | null;
  confidence: number;
  createdAt: string;
  reviewer: { id: string; name: string } | null;
}

// ─── List suggestions for a ticket ──────────────────────────────────────────

export async function getSuggestions(
  ticketId: string,
  companyId: string,
): Promise<SuggestionRecord[]> {
  await requireCompanyAccess(companyId);

  const rows = await prisma.aiSuggestion.findMany({
    where: { ticketId, companyId },
    orderBy: { createdAt: "desc" },
    include: {
      reviewer: { select: { id: true, name: true } },
    },
  });

  return rows.map((s) => ({
    id: s.id,
    ticketId: s.ticketId,
    companyId: s.companyId,
    channel: s.channel,
    analysis: (s.analysis ?? {}) as Record<string, unknown>,
    suggestedResponse: s.suggestedResponse,
    suggestedSubject: s.suggestedSubject,
    suggestedActions: (s.suggestedActions ?? []) as SuggestionRecord["suggestedActions"],
    raPrivateMessage: s.raPrivateMessage,
    raPublicMessage: s.raPublicMessage,
    raDetectedType: s.raDetectedType,
    raSuggestModeration: s.raSuggestModeration,
    status: s.status,
    reviewedBy: s.reviewedBy,
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
    editedResponse: s.editedResponse,
    editedSubject: s.editedSubject,
    rejectionReason: s.rejectionReason,
    confidence: s.confidence,
    createdAt: s.createdAt.toISOString(),
    reviewer: s.reviewer,
  }));
}

// ─── Get single suggestion ──────────────────────────────────────────────────

export async function getSuggestion(suggestionId: string, companyId: string) {
  await requireCompanyAccess(companyId);

  const suggestion = await prisma.aiSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      reviewer: { select: { id: true, name: true } },
      ticket: { select: { id: true, subject: true, companyId: true } },
    },
  });

  if (!suggestion || suggestion.ticket.companyId !== companyId) {
    return null;
  }

  return suggestion;
}

// ─── Approve suggestion ─────────────────────────────────────────────────────

export async function approveSuggestionAction(
  suggestionId: string,
  companyId: string,
  editedResponse?: string,
  editedSubject?: string,
) {
  const session = await requireCompanyAccess(companyId);

  return approveSuggestion(suggestionId, session.userId, editedResponse, editedSubject, companyId);
}

// ─── Reject suggestion ──────────────────────────────────────────────────────

export async function rejectSuggestionAction(
  suggestionId: string,
  companyId: string,
  reason?: string,
) {
  const session = await requireCompanyAccess(companyId);

  return rejectSuggestion(suggestionId, session.userId, reason, companyId);
}

// ─── Pending suggestions count for company ──────────────────────────────────

export async function getPendingSuggestionsCount(companyId: string) {
  await requireCompanyAccess(companyId);

  return prisma.aiSuggestion.count({
    where: { companyId, status: "PENDING" },
  });
}

// ─── Pending suggestions list for company ───────────────────────────────────

export async function getPendingSuggestions(companyId: string) {
  await requireCompanyAccess(companyId);

  return prisma.aiSuggestion.findMany({
    where: { companyId, status: "PENDING" },
    orderBy: { createdAt: "asc" }, // FIFO — oldest first
    include: {
      ticket: { select: { id: true, subject: true } },
    },
    take: 50,
  });
}
