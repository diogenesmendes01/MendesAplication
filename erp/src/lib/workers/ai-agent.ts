import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { runAgent } from "@/lib/ai/agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiAgentJobData {
  ticketId: string;
  companyId: string;
  messageContent: string;
  channel?: "WHATSAPP" | "EMAIL";
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processAiAgent(job: Job<AiAgentJobData>) {
  const { ticketId, companyId, messageContent, channel = "WHATSAPP" } = job.data;

  // 1. Check company-level AI config
  const aiConfig = await prisma.aiConfig.findUnique({
    where: { companyId },
  });

  if (!aiConfig || !aiConfig.enabled) {
    console.log(
      `[ai-agent] AI not enabled for company ${companyId}, skipping`
    );
    return;
  }

  // 2. Check ticket-level AI toggle
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { aiEnabled: true },
  });

  if (!ticket) {
    console.warn(`[ai-agent] Ticket ${ticketId} not found, skipping`);
    return;
  }

  if (!ticket.aiEnabled) {
    console.log(
      `[ai-agent] AI disabled for ticket ${ticketId}, skipping`
    );
    return;
  }

  // 3. Check escalation keywords before calling LLM
  if (aiConfig.escalationKeywords.length > 0) {
    const lowerContent = messageContent.toLowerCase();
    const matchedKeyword = aiConfig.escalationKeywords.find((keyword) =>
      lowerContent.includes(keyword.toLowerCase())
    );

    if (matchedKeyword) {
      console.log(
        `[ai-agent] Escalation keyword "${matchedKeyword}" detected in ticket ${ticketId}, escalating without LLM`
      );

      // Disable AI on the ticket and set status to OPEN
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { aiEnabled: false, status: "OPEN" },
      });

      // Create internal note about keyword-based escalation
      await prisma.ticketMessage.create({
        data: {
          ticketId,
          senderId: null,
          content: `[AI Agent] Escalado automaticamente — palavra-chave detectada: "${matchedKeyword}"`,
          isInternal: true,
          isAiGenerated: true,
        },
      });

      return;
    }
  }

  // 4. Run the AI agent loop
  console.log(
    `[ai-agent] Running agent for ticket ${ticketId}, company ${companyId}, channel ${channel}`
  );

  const result = await runAgent(ticketId, companyId, messageContent, channel);

  console.log(
    `[ai-agent] Agent completed for ticket ${ticketId}: responded=${result.responded}, escalated=${result.escalated}, iterations=${result.iterations}${result.error ? `, error=${result.error}` : ""}`
  );
}
