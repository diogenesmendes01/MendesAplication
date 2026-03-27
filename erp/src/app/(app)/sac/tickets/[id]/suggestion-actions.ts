"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import {
  approveSuggestion,
  rejectSuggestion,
} from "@/lib/ai/suggestion-mode";

// ─── List suggestions for a ticket ──────────────────────────────────────────

export async function getSuggestions(ticketId: string, companyId: string) {
  await requireCompanyAccess(companyId);

  return prisma.aiSuggestion.findMany({
    where: { ticketId, companyId },
    orderBy: { createdAt: "desc" },
    include: {
      reviewer: { select: { id: true, name: true } },
    },
  });
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
