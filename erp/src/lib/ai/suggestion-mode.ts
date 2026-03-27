import { prisma } from "@/lib/prisma";
import { executeTool } from "./tool-executor";
import type { ToolContext, ReclameAquiResponse } from "./tool-executor";
import type { CapturedAction } from "./agent";
import type { ChannelType } from "@prisma/client";
import { logger } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OperationMode = "auto" | "suggest" | "hybrid";

export interface SuggestionData {
  ticketId: string;
  companyId: string;
  channel: ChannelType;
  messageId?: string;
  analysis: Record<string, unknown>;
  suggestedResponse: string;
  suggestedSubject?: string | null;
  suggestedActions: CapturedAction[];
  raPrivateMessage?: string | null;
  raPublicMessage?: string | null;
  raDetectedType?: string | null;
  raSuggestModeration?: boolean;
  confidence: number;
}

// ─── Create AiSuggestion ──────────────────────────────────────────────────────

export async function createAiSuggestion(
  data: SuggestionData,
): Promise<string> {
  const suggestion = await prisma.aiSuggestion.create({
    data: {
      ticketId: data.ticketId,
      companyId: data.companyId,
      channel: data.channel,
      messageId: data.messageId,

      analysis: data.analysis as any,
      suggestedResponse: data.suggestedResponse,
      suggestedSubject: data.suggestedSubject,
      suggestedActions: data.suggestedActions as any,

      raPrivateMessage: data.raPrivateMessage,
      raPublicMessage: data.raPublicMessage,
      raDetectedType: data.raDetectedType,
      raSuggestModeration: data.raSuggestModeration ?? false,

      confidence: data.confidence,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });

  // Mark the trigger message as PENDING_APPROVAL
  if (data.messageId) {
    await prisma.ticketMessage.update({
      where: { id: data.messageId },
      data: { deliveryStatus: "PENDING_APPROVAL" },
    });
  }

  logger.info(
    {
      suggestionId: suggestion.id,
      ticketId: data.ticketId,
      channel: data.channel,
      confidence: data.confidence,
    },
    "AI suggestion created",
  );

  return suggestion.id;
}

// ─── Approve suggestion (with race condition protection) ─────────────────────

export async function approveSuggestion(
  suggestionId: string,
  userId: string,
  editedResponse?: string,
  editedSubject?: string,
  companyId?: string,
): Promise<{ success: boolean; error?: string }> {
  // Use a transaction with atomic status check to prevent race conditions
  // (two users approving the same suggestion simultaneously)
  const result = await prisma.$transaction(async (tx) => {
    // Atomically claim the suggestion by updating PENDING → processing
    const claimed = await tx.aiSuggestion.updateMany({
      where: { id: suggestionId, status: "PENDING" },
      data: { status: "PROCESSING" },
    });

    if (claimed.count === 0) {
      return { success: false as const, error: "Suggestion not found or already processed" };
    }

    const suggestion = await tx.aiSuggestion.findUnique({
      where: { id: suggestionId },
      include: {
        ticket: {
          select: {
            id: true,
            clientId: true,
            companyId: true,
            contact: { select: { whatsapp: true } },
            client: { select: { telefone: true } },
          },
        },
      },
    });

    if (!suggestion) {
      return { success: false as const, error: "Suggestion not found" };
    }

    // Tenant isolation: validate companyId matches the suggestion's ticket
    if (companyId && suggestion.ticket.companyId !== companyId) {
      // Rollback status
      await tx.aiSuggestion.update({
        where: { id: suggestionId },
        data: { status: "PENDING" },
      });
      return { success: false as const, error: "Access denied: suggestion belongs to another company" };
    }

    return { success: true as const, suggestion };
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const suggestion = result.suggestion;
  const finalResponse = editedResponse || suggestion.suggestedResponse;
  const finalSubject = editedSubject || suggestion.suggestedSubject;
  const status = editedResponse ? "EDITED" : "APPROVED";

  // Execute captured actions in order
  const actions = (suggestion.suggestedActions as unknown as CapturedAction[]) || [];
  const toolResults: Array<{ tool: string; result: string; success: boolean }> = [];

  const contactPhone =
    suggestion.ticket.contact?.whatsapp ||
    suggestion.ticket.client?.telefone ||
    "";

  const context: ToolContext = {
    ticketId: suggestion.ticketId,
    companyId: suggestion.companyId,
    clientId: suggestion.ticket.clientId,
    contactPhone: contactPhone.replace(/\D/g, ""),
    channel: suggestion.channel,
    dryRun: false,
    suggestionMode: false, // Now execute for real
  };

  for (const action of [...actions].sort((a, b) => a.order - b.order)) {
    const args = { ...action.args };

    // Override response content if edited
    if (
      ["RESPOND", "RESPOND_EMAIL", "RESPOND_RECLAMEAQUI"].includes(
        action.toolName,
      )
    ) {
      if (action.toolName === "RESPOND") {
        args.message = finalResponse;
      } else if (action.toolName === "RESPOND_EMAIL") {
        args.message = finalResponse;
        if (finalSubject) args.subject = finalSubject;
      } else if (action.toolName === "RESPOND_RECLAMEAQUI") {
        if (editedResponse) {
          try {
            const parsed = JSON.parse(editedResponse);
            args.privateMessage = parsed.privateMessage || args.privateMessage;
            args.publicMessage = parsed.publicMessage || args.publicMessage;
          } catch {
            args.privateMessage = editedResponse;
          }
        }
      }
    }

    try {
      const toolResult = await executeTool(action.toolName, args, context);
      toolResults.push({ tool: action.toolName, result: toolResult, success: true });
    } catch (error) {
      toolResults.push({
        tool: action.toolName,
        result: error instanceof Error ? error.message : String(error),
        success: false,
      });
    }
  }

  const allSuccess = toolResults.every((r) => r.success);

  // Update suggestion status
  await prisma.aiSuggestion.update({
    where: { id: suggestionId },
    data: {
      status,
      reviewedBy: userId,
      reviewedAt: new Date(),
      editedResponse: editedResponse || null,
      editedSubject: editedSubject || null,
      executionResult: {
        success: allSuccess,
        toolResults,
        executedAt: new Date().toISOString(),
      },
    },
  });

  logger.info(
    { suggestionId, status, success: allSuccess },
    "AI suggestion resolved",
  );

  return { success: allSuccess };
}

// ─── Reject suggestion (with race condition protection) ──────────────────────

export async function rejectSuggestion(
  suggestionId: string,
  userId: string,
  reason?: string,
  companyId?: string,
): Promise<{ success: boolean; error?: string }> {
  // Atomic update: only reject if still PENDING (prevents race condition)
  const result = await prisma.$transaction(async (tx) => {
    // Fetch suggestion to validate tenant isolation
    if (companyId) {
      const suggestion = await tx.aiSuggestion.findUnique({
        where: { id: suggestionId },
        select: {
          id: true,
          status: true,
          ticket: { select: { companyId: true } },
        },
      });

      if (!suggestion) {
        return { success: false as const, error: "Suggestion not found or already processed" };
      }

      if (suggestion.ticket.companyId !== companyId) {
        return { success: false as const, error: "Access denied: suggestion belongs to another company" };
      }

      if (suggestion.status !== "PENDING") {
        return { success: false as const, error: "Suggestion not found or already processed" };
      }
    }

    const updated = await tx.aiSuggestion.updateMany({
      where: { id: suggestionId, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewedBy: userId,
        reviewedAt: new Date(),
        rejectionReason: reason || null,
      },
    });

    if (updated.count === 0) {
      return { success: false as const, error: "Suggestion not found or already processed" };
    }

    return { success: true as const };
  });

  if (result.success) {
    logger.info({ suggestionId, reason }, "AI suggestion rejected");
  }

  return result;
}

// ─── Confidence calculator ───────────────────────────────────────────────────

export function calculateConfidence(data: {
  searchResultsFound?: boolean;
  highSimilarityMatch?: boolean;
  clientIdentified?: boolean;
  historyAvailable?: boolean;
  toolsExecuted?: string[];
  llmConfidence?: number;
}): number {
  let confidence = 0.2; // base

  if (data.highSimilarityMatch) confidence += 0.2;
  if (data.clientIdentified) confidence += 0.15;
  if (data.searchResultsFound) confidence += 0.1;
  if (data.historyAvailable) confidence += 0.1;
  if (data.toolsExecuted?.includes("GET_CLIENT_INFO")) confidence += 0.05;

  // Average with LLM self-reported confidence if available
  if (data.llmConfidence !== undefined && data.llmConfidence > 0) {
    confidence = (confidence + data.llmConfidence) / 2;
  }

  return Math.min(1.0, Math.round(confidence * 100) / 100);
}

// ─── Resolve operation mode ──────────────────────────────────────────────────

/**
 * Determines whether the agent loop should run in suggestion mode
 * based on the resolved operationMode from AiConfig.
 */
export function shouldRunAsSuggestion(operationMode: OperationMode): boolean {
  return operationMode === "suggest" || operationMode === "hybrid";
}

/**
 * After the agent loop completes in hybrid mode, decides whether to
 * auto-execute or save as suggestion based on confidence and config.
 */
export function shouldAutoExecuteHybrid(
  confidence: number,
  threshold: number,
  capturedActions: CapturedAction[],
  alwaysRequireApproval: string[],
): boolean {
  // Any action in the "always require approval" list → must be a suggestion
  const hasAlwaysApprove = capturedActions.some((a) =>
    alwaysRequireApproval.includes(a.toolName),
  );

  if (hasAlwaysApprove) return false;

  return confidence >= threshold;
}
