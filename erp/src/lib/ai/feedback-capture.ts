import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ChannelType } from "@prisma/client";

export type FeedbackType = "positive" | "correction" | "negative" | "ignored" | "unnecessary_escalation";

export interface FeedbackInput {
  companyId: string;
  suggestionId: string;
  ticketId: string;
  channel: ChannelType;
  originalResponse: string;
  confidence: number;
}

export function computeDiff(original: string, edited: string): Record<string, unknown> {
  const originalWords = original.split(/\s+/).filter(Boolean);
  const editedWords = edited.split(/\s+/).filter(Boolean);
  const originalSet = new Set(originalWords);
  const editedSet = new Set(editedWords);
  const added = editedWords.filter((w) => !originalSet.has(w)).length;
  const removed = originalWords.filter((w) => !editedSet.has(w)).length;
  const total = Math.max(originalWords.length, editedWords.length, 1);
  const changePercent = ((added + removed) / total) * 100;
  return {
    changePercent: Math.round(changePercent * 100) / 100,
    wordsAdded: added,
    wordsRemoved: removed,
    lengthDelta: edited.length - original.length,
    isMinorEdit: changePercent < 20,
  };
}

export async function captureFeedback(
  input: FeedbackInput,
  action: "APPROVED" | "REJECTED" | "EDITED",
  editedResponse?: string | null,
  rejectionReason?: string | null,
): Promise<string> {
  let type: FeedbackType;
  let diff: Record<string, unknown> | null = null;
  switch (action) {
    case "APPROVED": type = "positive"; break;
    case "EDITED":
      type = "correction";
      if (editedResponse) diff = computeDiff(input.originalResponse, editedResponse);
      break;
    case "REJECTED": type = "negative"; break;
  }
  const feedback = await prisma.aiFeedback.create({
    data: {
      companyId: input.companyId,
      suggestionId: input.suggestionId,
      ticketId: input.ticketId,
      channel: input.channel,
      type,
      originalResponse: input.originalResponse,
      editedResponse: action === "EDITED" ? (editedResponse ?? null) : null,
      rejectionReason: action === "REJECTED" ? (rejectionReason ?? null) : null,
      diff,
    },
  });
  logger.info({ feedbackId: feedback.id, suggestionId: input.suggestionId, type, channel: input.channel }, "AI feedback captured");
  return feedback.id;
}
