import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { runAgent } from "@/lib/ai/agent";
import { reclameaquiOutboundQueue } from "@/lib/queue";
import { logger } from "@/lib/logger";
import { resolveAiConfigSelect } from "@/lib/ai/resolve-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiAgentJobData {
  ticketId: string;
  companyId: string;
  messageContent: string;
  channel?: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI";
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
// Main processor
// ---------------------------------------------------------------------------

export async function processAiAgent(job: Job<AiAgentJobData>) {
  const { ticketId, companyId, messageContent, channel = "WHATSAPP" } = job.data;

  // 1. Check ticket-level AI toggle before hitting the LLM.
  //    Note: company-level AI config (enabled, channel, spend limit, escalation
  //    keywords) is now fully handled inside runAgent — no duplicate DB query here.
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { aiEnabled: true },
  });

  if (!ticket) {
    logger.warn(`[ai-agent] Ticket ${ticketId} not found, skipping`);
    return;
  }

  if (!ticket.aiEnabled) {
    logger.info(
      `[ai-agent] AI disabled for ticket ${ticketId}, skipping`
    );
    return;
  }

  // 2. For RECLAMEAQUI: check raMode before running the agent
  if (channel === "RECLAMEAQUI") {
    const aiConfig = await resolveAiConfigSelect(companyId, channel, {
      raMode: true,
      raEscalationKeywords: true,
      raPrivateBeforePublic: true,
      raAutoRequestEvaluation: true,
    });

    const raMode = aiConfig?.raMode || "suggest";

    if (raMode === "off") {
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

    // Run the AI agent for RECLAMEAQUI
    logger.info(
      `[ai-agent] Running RA agent for ticket ${ticketId}, company ${companyId}, mode=${raMode}`
    );

    const result = await runAgent(ticketId, companyId, messageContent, "RECLAMEAQUI");

    logger.info(
      `[ai-agent] RA agent completed for ticket ${ticketId}: responded=${result.responded}, escalated=${result.escalated}, iterations=${result.iterations}${result.error ? `, error=${result.error}` : ""}`
    );

    // Handle the RA response based on mode
    if (result.responded && result.raResponse) {
      const { privateMessage, publicMessage, detectedType, confidence, suggestModeration, moderationReason: _moderationReason } =
        result.raResponse;

      if (raMode === "auto") {
        // Auto mode: enqueue for immediate send via outbound worker
        // But re-check escalation keywords in the generated responses as safety net
        const allText = `${privateMessage} ${publicMessage}`.toLowerCase();
        const responseEscalationMatch = raKeywords.find((kw) =>
          allText.includes(kw.toLowerCase())
        );

        if (responseEscalationMatch) {
          logger.warn(
            `[ai-agent] RA auto-mode safety: escalation keyword "${responseEscalationMatch}" found in AI response for ticket ${ticketId}, falling back to suggest mode`
          );
          // Fall through to suggest mode behavior
          await saveAsSuggestion(ticketId, result.raResponse);
          return;
        }

        // If trabalhista → suggest moderation instead of auto-send
        if (suggestModeration) {
          logger.info(
            `[ai-agent] RA auto-mode: trabalhista detected for ticket ${ticketId}, saving as suggestion with moderation flag`
          );
          await saveAsSuggestion(ticketId, result.raResponse);
          return;
        }

        // Fetch client email for private message
        const ticketWithClient = await prisma.ticket.findUnique({
          where: { id: ticketId },
          include: { client: { select: { email: true } } },
        });
        const clientEmail = ticketWithClient?.client?.email;

        if (clientEmail) {
          // Enqueue dual send (public + private)
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
          // No client email — fall back to public only
          await reclameaquiOutboundQueue.add("RA_SEND_PUBLIC", {
            ticketId,
            companyId,
            message: publicMessage,
          });

          logger.warn(
            `[ai-agent] RA auto-mode: no client email for ticket ${ticketId}, falling back to RA_SEND_PUBLIC`
          );
        }

        // Also request evaluation if configured
        if (aiConfig?.raAutoRequestEvaluation) {
          await reclameaquiOutboundQueue.add("RA_REQUEST_EVALUATION", {
            ticketId,
            companyId,
          });
        }
      } else {
        // Suggest mode (default): save as pending approval
        await saveAsSuggestion(ticketId, result.raResponse);

        logger.info(
          `[ai-agent] RA suggest-mode: saved suggestion for ticket ${ticketId} (type=${detectedType}, confidence=${confidence})`
        );
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

  // 3. Run the AI agent loop for WHATSAPP / EMAIL (original behavior)
  logger.info(
    `[ai-agent] Running agent for ticket ${ticketId}, company ${companyId}, channel ${channel}`
  );

  const result = await runAgent(ticketId, companyId, messageContent, channel);

  logger.info(
    `[ai-agent] Agent completed for ticket ${ticketId}: responded=${result.responded}, escalated=${result.escalated}, iterations=${result.iterations}${result.error ? `, error=${result.error}` : ""}`
  );
}

// ---------------------------------------------------------------------------
// Helper: save RA AI response as a suggestion (PENDING_APPROVAL)
// ---------------------------------------------------------------------------

async function saveAsSuggestion(
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
