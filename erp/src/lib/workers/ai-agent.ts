import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { runAgent } from "@/lib/ai/agent";
import type { AgentResult } from "@/lib/ai/agent";
import { reclameaquiOutboundQueue } from "@/lib/queue";
import { logger } from "@/lib/logger";
import { resolveAiConfigSelect } from "@/lib/ai/resolve-config";
import {
  calculateConfidence,
  createAiSuggestion,
  shouldRunAsSuggestion,
  shouldAutoExecuteHybrid,
  approveSuggestion as executeSuggestionActions,
} from "@/lib/ai/suggestion-mode";
import type { OperationMode } from "@/lib/ai/suggestion-mode";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import { buildFallbackChain } from "@/lib/ai/fallback";
import { isProviderError } from "@/lib/ai/fallback";
import { markTicketPendingRecovery } from "@/lib/ai/recovery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiAgentJobData {
  ticketId: string;
  companyId: string;
  messageContent: string;
  messageId?: string; // Inbound TicketMessage id that triggered the agent
  channel?: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI";
  /** Enriched RA ticket context for better AI suggestions */
  raContext?: import("@/lib/reclameaqui/types").RaAiContext;
  /** Flag indicating this job was re-queued from recovery */
  isRecovery?: boolean;
}

// ---------------------------------------------------------------------------
// Reclame Aqui escalation keywords (hardcoded fallback)
// ---------------------------------------------------------------------------

const RA_DEFAULT_ESCALATION_KEYWORDS = [
  "processo",
  "advogado",
  "procon",
  "judicial",
  "indenização",
];

// ---------------------------------------------------------------------------
// Helper: compute confidence from agent result for non-RA channels
// ---------------------------------------------------------------------------

function computeConfidenceFromResult(result: AgentResult): number {
  // For RA channels, use the RA response confidence directly
  if (result.raResponse?.confidence !== undefined) {
    return result.raResponse.confidence;
  }

  // For WhatsApp/Email, derive confidence from ALL executed tools (read + write)
  // result.toolsExecuted includes read-only tools (SEARCH_DOCUMENTS, GET_CLIENT_INFO, etc.)
  // that capturedActions misses (it only tracks write tools)
  const toolsExecuted = result.toolsExecuted || [];

  return calculateConfidence({
    searchResultsFound: toolsExecuted.includes("SEARCH_DOCUMENTS"),
    clientIdentified: toolsExecuted.includes("GET_CLIENT_INFO") ||
      toolsExecuted.includes("LOOKUP_CLIENT_BY_CNPJ"),
    historyAvailable: toolsExecuted.includes("GET_HISTORY"),
    toolsExecuted,
    // High similarity match heuristic: if agent found docs AND responded, likely good match
    highSimilarityMatch: toolsExecuted.includes("SEARCH_DOCUMENTS") && result.responded,
  });
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processAiAgent(job: Job<AiAgentJobData>) {
  const { ticketId, companyId, messageContent, messageId, channel = "WHATSAPP", raContext, isRecovery } = job.data;

  if (isRecovery) {
    logger.info(`[ai-agent] Processing recovery job for ticket ${ticketId}`);
  }

  // Check ticket-level AI toggle and get client CNPJ for RA enrichment.
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { aiEnabled: true, client: { select: { cpfCnpj: true } } },
  });

  // 1. Rate Limit Check (per-ticket): AI toggle, budget, cooldown, interactions/hour
  const rateLimit = await checkRateLimit(ticketId, companyId, channel);
  if (!rateLimit.allowed) {
    logger.info(`[ai-agent] Rate limited: ticket ${ticketId}, reason=${rateLimit.reason}`);
    return;
  }
  if (rateLimit.delayMs && rateLimit.delayMs > 0) {
    logger.info(`[ai-agent] Cooldown active for ticket ${ticketId}, delaying ${rateLimit.delayMs}ms`);
    await job.moveToDelayed(Date.now() + rateLimit.delayMs, job.token);
    return;
  }

  // ─── Build fallback chain for this company/channel ─────────────────────
  const fallbackChain = await buildFallbackChain(companyId, channel);

  // ─── Resolve operation mode ─────────────────────────────────────────────
  const aiConfig = await resolveAiConfigSelect(companyId, channel, {
    operationMode: true,
    hybridThreshold: true,
    alwaysRequireApproval: true,
    raMode: true,
    raEscalationKeywords: true,
    raPrivateBeforePublic: true,
    raAutoRequestEvaluation: true,
  });

  const operationMode = (aiConfig?.operationMode || "auto") as OperationMode;

  // 2. For RECLAMEAQUI: check raMode (backward compat) and escalation keywords
  if (channel === "RECLAMEAQUI") {
    // Backward compat: use raMode if operationMode is still default "auto"
    // and raMode is explicitly set
    const effectiveMode: OperationMode =
      operationMode !== "auto"
        ? operationMode
        : aiConfig?.raMode === "suggest"
          ? "suggest"
          : aiConfig?.raMode === "off"
            ? "auto" // off is handled below
            : "auto";

    if (aiConfig?.raMode === "off" && operationMode === "auto") {
      logger.info(
        `[ai-agent] RA mode is 'off' for company ${companyId}, skipping ticket ${ticketId}`
      );
      return;
    }

    // Check RA-specific escalation keywords BEFORE running LLM (even in auto mode)
    const raKeywords = aiConfig?.raEscalationKeywords?.length
      ? aiConfig.raEscalationKeywords
      : RA_DEFAULT_ESCALATION_KEYWORDS;

    const lowerContent = messageContent.toLowerCase();
    const matchedKeyword = raKeywords.find((kw) =>
      lowerContent.includes(kw.toLowerCase())
    );

    if (matchedKeyword) {
      logger.info(
        `[ai-agent] RA escalation keyword "${matchedKeyword}" detected in ticket ${ticketId}, escalating to human`
      );

      await prisma.ticket.update({
        where: { id: ticketId },
        data: { aiEnabled: false, status: "OPEN" },
      });

      await prisma.ticketMessage.create({
        data: {
          ticketId,
          senderId: null,
          content: `[AI Agent] Escalado automaticamente (Reclame Aqui) — palavra-chave detectada: "${matchedKeyword}"`,
          isInternal: true,
          isAiGenerated: true,
          channel: "RECLAMEAQUI",
        },
      });

      return;
    }

    // Run the AI agent for RECLAMEAQUI (with fallback chain)
    const useSuggestionMode = shouldRunAsSuggestion(effectiveMode);
    logger.info(
      `[ai-agent] Running RA agent for ticket ${ticketId}, company ${companyId}, mode=${effectiveMode}, suggestionMode=${useSuggestionMode}, fallbackChain=${fallbackChain.length}`
    );

    // Enrich raContext with CNPJ identification flag
    const enrichedRaContext: import("@/lib/reclameaqui/types").RaAiContext | undefined = raContext ? {
      ...raContext,
      needsCnpjIdentification: ticket?.client?.cpfCnpj?.startsWith("RA-") ?? false,
    } : undefined;
    let result: AgentResult;
    try {
      result = await runAgent(ticketId, companyId, messageContent, "RECLAMEAQUI", {
        suggestionMode: useSuggestionMode,
        raContext: enrichedRaContext,
        fallbackChain: fallbackChain.length > 1 ? fallbackChain : undefined,
      });
    } catch (error) {
      if (isProviderError(error)) {
        logger.warn(
          { ticketId, companyId, error: error instanceof Error ? error.message : String(error) },
          "[ai-agent] All providers failed for RA ticket, marking for recovery"
        );
        await markTicketPendingRecovery(ticketId);
        return;
      }
      throw error;
    }

    logger.info(
      `[ai-agent] RA agent completed for ticket ${ticketId}: responded=${result.responded}, escalated=${result.escalated}, iterations=${result.iterations}${result.error ? `, error=${result.error}` : ""}`
    );

    // Handle result based on operation mode
    if (result.responded && result.raResponse) {
      const { privateMessage, publicMessage, detectedType, confidence, suggestModeration } =
        result.raResponse;

      // For suggest/hybrid modes → use new AiSuggestion system
      if (effectiveMode === "suggest") {
        const computedConfidence = computeConfidenceFromResult(result);
        await createSuggestionFromResult(ticketId, companyId, "RECLAMEAQUI", result, messageId, computedConfidence);
        logger.info(
          `[ai-agent] RA suggest-mode: saved AiSuggestion for ticket ${ticketId} (type=${detectedType}, confidence=${computedConfidence})`
        );
        return;
      }

      if (effectiveMode === "hybrid") {
        const threshold = aiConfig?.hybridThreshold ?? 0.8;
        const alwaysApprove = aiConfig?.alwaysRequireApproval || [];
        const capturedActions = result.capturedActions || [];
        const computedConfidence = computeConfidenceFromResult(result);

        if (shouldAutoExecuteHybrid(computedConfidence, threshold, capturedActions, alwaysApprove)) {
          // High confidence + no sensitive actions → fall through to auto execution
          logger.info(
            `[ai-agent] RA hybrid-mode: auto-executing for ticket ${ticketId} (confidence=${computedConfidence} >= threshold=${threshold})`
          );
          // Fall through to auto mode below
        } else {
          await createSuggestionFromResult(ticketId, companyId, "RECLAMEAQUI", result, messageId, computedConfidence);
          logger.info(
            `[ai-agent] RA hybrid-mode: saved AiSuggestion for ticket ${ticketId} (confidence=${computedConfidence} < threshold=${threshold})`
          );
          return;
        }
      }

      // Auto mode (or hybrid auto-execute): original behavior
      // Re-check escalation keywords in the generated responses as safety net
      const allText = `${privateMessage} ${publicMessage}`.toLowerCase();
      const responseEscalationMatch = raKeywords.find((kw) =>
        allText.includes(kw.toLowerCase())
      );

      if (responseEscalationMatch) {
        logger.warn(
          `[ai-agent] RA auto-mode safety: escalation keyword "${responseEscalationMatch}" found in AI response for ticket ${ticketId}, saving as suggestion`
        );
        await saveAsLegacySuggestion(ticketId, result.raResponse);
        return;
      }

      // If trabalhista → suggest moderation instead of auto-send
      if (suggestModeration) {
        logger.info(
          `[ai-agent] RA auto-mode: trabalhista detected for ticket ${ticketId}, saving as suggestion with moderation flag`
        );
        await saveAsLegacySuggestion(ticketId, result.raResponse);
        return;
      }

      // Fetch client email for private message
      const ticketWithClient = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { client: { select: { email: true } } },
      });
      const clientEmail = ticketWithClient?.client?.email;

      if (clientEmail) {
        await reclameaquiOutboundQueue.add("RA_SEND_DUAL", {
          ticketId,
          companyId,
          privateMessage,
          publicMessage,
          email: clientEmail,
        });

        logger.info(
          `[ai-agent] RA auto-mode: enqueued RA_SEND_DUAL for ticket ${ticketId} (type=${detectedType}, confidence=${confidence})`
        );
      } else {
        await reclameaquiOutboundQueue.add("RA_SEND_PUBLIC", {
          ticketId,
          companyId,
          message: publicMessage,
        });

        logger.warn(
          `[ai-agent] RA auto-mode: no client email for ticket ${ticketId}, falling back to RA_SEND_PUBLIC`
        );
      }

      if (aiConfig?.raAutoRequestEvaluation) {
        await reclameaquiOutboundQueue.add("RA_REQUEST_EVALUATION", {
          ticketId,
          companyId,
        });
      }
    } else if (result.escalated) {
      logger.info(
        `[ai-agent] RA agent escalated ticket ${ticketId} to human`
      );
    } else {
      logger.warn(
        `[ai-agent] RA agent did not produce a response for ticket ${ticketId}: error=${result.error}`
      );
    }

    return;
  }

  // 3. Run the AI agent loop for WHATSAPP / EMAIL (with fallback chain)
  const useSuggestionMode = shouldRunAsSuggestion(operationMode);
  logger.info(
    `[ai-agent] Running agent for ticket ${ticketId}, company ${companyId}, channel ${channel}, mode=${operationMode}, suggestionMode=${useSuggestionMode}, fallbackChain=${fallbackChain.length}`
  );

  let result: AgentResult;
  try {
    result = await runAgent(ticketId, companyId, messageContent, channel, {
      suggestionMode: useSuggestionMode,
      fallbackChain: fallbackChain.length > 1 ? fallbackChain : undefined,
    });
  } catch (error) {
    if (isProviderError(error)) {
      logger.warn(
        { ticketId, companyId, channel, error: error instanceof Error ? error.message : String(error) },
        "[ai-agent] All providers failed, marking ticket for recovery"
      );
      await markTicketPendingRecovery(ticketId);
      return;
    }
    throw error;
  }

  logger.info(
    `[ai-agent] Agent completed for ticket ${ticketId}: responded=${result.responded}, escalated=${result.escalated}, iterations=${result.iterations}${result.error ? `, error=${result.error}` : ""}`
  );

  // ─── Post-processing based on operation mode ──────────────────────────
  if (operationMode === "auto") {
    // Original behavior — tools already executed in agent loop
    return;
  }

  if (operationMode === "suggest") {
    if (result.responded || (result.capturedActions && result.capturedActions.length > 0)) {
      const confidence = computeConfidenceFromResult(result);
      await createSuggestionFromResult(ticketId, companyId, channel, result, messageId, confidence);
      logger.info(
        `[ai-agent] suggest-mode: saved AiSuggestion for ticket ${ticketId} (confidence=${confidence})`
      );
    }
    return;
  }

  if (operationMode === "hybrid") {
    const threshold = aiConfig?.hybridThreshold ?? 0.8;
    const alwaysApprove = aiConfig?.alwaysRequireApproval || [];
    const capturedActions = result.capturedActions || [];
    const confidence = computeConfidenceFromResult(result);

    if (capturedActions.length === 0) {
      // No write actions captured — nothing to suggest
      return;
    }

    if (shouldAutoExecuteHybrid(confidence, threshold, capturedActions, alwaysApprove)) {
      // High confidence → create suggestion and immediately approve it (auto-execute)
      const suggestionId = await createSuggestionFromResult(
        ticketId, companyId, channel, result, messageId, confidence
      );
      await executeSuggestionActions(suggestionId, "system");
      logger.info(
        `[ai-agent] hybrid-mode: auto-executed for ticket ${ticketId} (confidence=${confidence} >= threshold=${threshold})`
      );
    } else {
      await createSuggestionFromResult(ticketId, companyId, channel, result, messageId, confidence);
      logger.info(
        `[ai-agent] hybrid-mode: saved AiSuggestion for ticket ${ticketId} (confidence=${confidence} < threshold=${threshold})`
      );
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Helper: Create AiSuggestion from AgentResult
// ---------------------------------------------------------------------------

async function createSuggestionFromResult(
  ticketId: string,
  companyId: string,
  channel: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI",
  result: AgentResult,
  messageId?: string,
  confidence?: number,
): Promise<string> {
  const capturedActions = result.capturedActions || [];

  // Extract suggested response from captured actions
  let suggestedResponse = "";
  let suggestedSubject: string | null = null;

  for (const action of capturedActions) {
    if (["RESPOND", "RESPOND_EMAIL"].includes(action.toolName)) {
      suggestedResponse = (action.args.message as string) || "";
      if (action.toolName === "RESPOND_EMAIL") {
        suggestedSubject = (action.args.subject as string) || null;
      }
      break;
    }
    if (action.toolName === "RESPOND_RECLAMEAQUI") {
      suggestedResponse = JSON.stringify({
        privateMessage: action.args.privateMessage,
        publicMessage: action.args.publicMessage,
      });
      break;
    }
  }

  // Use provided confidence or compute from result
  const finalConfidence = confidence ?? computeConfidenceFromResult(result);

  return createAiSuggestion({
    ticketId,
    companyId,
    channel,
    messageId,
    analysis: {
      intent: "detected_by_agent",
      iterations: result.iterations,
      responded: result.responded,
      escalated: result.escalated,
    },
    suggestedResponse,
    suggestedSubject,
    suggestedActions: capturedActions,
    raPrivateMessage: result.raResponse?.privateMessage,
    raPublicMessage: result.raResponse?.publicMessage,
    raDetectedType: result.raResponse?.detectedType,
    raSuggestModeration: result.raResponse?.suggestModeration,
    confidence: finalConfidence,
  });
}

// ---------------------------------------------------------------------------
// Legacy helper: save RA AI response as TicketMessage (backward compat)
// Used in auto mode for safety fallbacks (escalation keyword in response, trabalhista)
// ---------------------------------------------------------------------------

async function saveAsLegacySuggestion(
  ticketId: string,
  raResponse: {
    privateMessage: string;
    publicMessage: string;
    detectedType: string;
    confidence: number;
    suggestModeration?: boolean;
    moderationReason?: number;
  }
): Promise<void> {
  const content = JSON.stringify({
    privateMessage: raResponse.privateMessage,
    publicMessage: raResponse.publicMessage,
    detectedType: raResponse.detectedType,
    confidence: raResponse.confidence,
    suggestModeration: raResponse.suggestModeration || false,
    moderationReason: raResponse.moderationReason || null,
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId,
      senderId: null,
      content,
      channel: "RECLAMEAQUI",
      direction: "OUTBOUND",
      origin: "SYSTEM",
      isInternal: false,
      isAiGenerated: true,
      deliveryStatus: "PENDING_APPROVAL",
    },
  });
}
