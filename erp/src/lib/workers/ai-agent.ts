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

  // 1. Check ticket-level AI toggle before hitting the LLM.
  //    Note: company-level AI config (enabled, channel, spend limit, escalation
  //    keywords) is now fully handled inside runAgent — no duplicate DB query here.
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

  // 2. Run the AI agent loop (handles aiConfig checks + escalation keywords internally)
  console.log(
    `[ai-agent] Running agent for ticket ${ticketId}, company ${companyId}, channel ${channel}`
  );

  const result = await runAgent(ticketId, companyId, messageContent, channel);

  console.log(
    `[ai-agent] Agent completed for ticket ${ticketId}: responded=${result.responded}, escalated=${result.escalated}, iterations=${result.iterations}${result.error ? `, error=${result.error}` : ""}`
  );
}
