"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import {
  approveSuggestion,
  rejectSuggestion,
} from "@/lib/ai/suggestion-mode";

// ─── List suggestions for a ticket ──────────────────────────────────────────

export async function getSuggestions(ticketId: string) {
  await requireSession();

  return prisma.aiSuggestion.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
    include: {
      reviewer: { select: { id: true, name: true } },
    },
  });
}

// ─── Get single suggestion ──────────────────────────────────────────────────

export async function getSuggestion(suggestionId: string) {
  await requireSession();

  return prisma.aiSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      reviewer: { select: { id: true, name: true } },
      ticket: { select: { id: true, subject: true } },
    },
  });
}

// ─── Approve suggestion ─────────────────────────────────────────────────────

export async function approveSuggestionAction(
  suggestionId: string,
  editedResponse?: string,
  editedSubject?: string,
) {
  const session = await requireSession();

  return approveSuggestion(suggestionId, session.userId, editedResponse, editedSubject);
}

// ─── Reject suggestion ──────────────────────────────────────────────────────

export async function rejectSuggestionAction(
  suggestionId: string,
  reason?: string,
) {
  const session = await requireSession();

  return rejectSuggestion(suggestionId, session.userId, reason);
}

// ─── Pending suggestions count for company ──────────────────────────────────

export async function getPendingSuggestionsCount(companyId: string) {
  await requireSession();

  return prisma.aiSuggestion.count({
    where: { companyId, status: "PENDING" },
  });
}

// ─── Pending suggestions list for company ───────────────────────────────────

export async function getPendingSuggestions(companyId: string) {
  await requireSession();

  return prisma.aiSuggestion.findMany({
    where: { companyId, status: "PENDING" },
    orderBy: { createdAt: "asc" }, // FIFO — oldest first
    include: {
      ticket: { select: { id: true, subject: true } },
    },
    take: 50,
  });
}
