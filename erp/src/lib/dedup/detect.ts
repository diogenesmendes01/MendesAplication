import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sseBus } from "@/lib/sse";
import { keywordSimilarity, getMatchedTerms } from "./similarity";

const DEDUP_WINDOW_HOURS = parseInt(process.env.DEDUP_WINDOW_HOURS || "168", 10);
const DEDUP_KEYWORD_THRESHOLD = parseFloat(process.env.DEDUP_KEYWORD_THRESHOLD || "0.3");
const DEDUP_DUPLICATE_THRESHOLD = parseFloat(process.env.DEDUP_DUPLICATE_THRESHOLD || "0.6");

export interface DedupResult {
  ticketAId: string;
  ticketBId: string;
  type: "DUPLICATE" | "RELATED";
  confidence: number;
  metadata: { keywordScore: number; matchedTerms: string[] };
}

export async function detectDuplicates(ticketId: string): Promise<DedupResult[]> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      client: { select: { id: true, cpfCnpj: true } },
      channel: { select: { id: true, type: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { content: true } },
    },
  });

  if (!ticket) { logger.warn({ ticketId }, "[dedup] Ticket not found"); return []; }
  if (!ticket.client?.cpfCnpj || ticket.client.cpfCnpj === "DESCONHECIDO") { return []; }
  if (!ticket.channel) { return []; }

  const cutoff = new Date(Date.now() - DEDUP_WINDOW_HOURS * 60 * 60 * 1000);
  const candidates = await prisma.ticket.findMany({
    where: {
      id: { not: ticketId }, clientId: ticket.clientId, companyId: ticket.companyId,
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] },
      createdAt: { gte: cutoff }, mergedIntoId: null,
      channel: { type: { not: ticket.channel.type } },
    },
    include: { channel: { select: { type: true } }, messages: { take: 1, orderBy: { createdAt: "asc" }, select: { content: true } } },
  });

  if (candidates.length === 0) return [];

  const ticketText = [ticket.subject, ticket.messages[0]?.content].filter(Boolean).join(" ");
  const results: DedupResult[] = [];

  for (const candidate of candidates) {
    const candidateText = [candidate.subject, candidate.messages[0]?.content].filter(Boolean).join(" ");
    const kwScore = keywordSimilarity(ticketText, candidateText);
    if (kwScore < DEDUP_KEYWORD_THRESHOLD) continue;

    const exists = await prisma.ticketLink.findFirst({
      where: { OR: [{ ticketAId: candidate.id, ticketBId: ticketId }, { ticketAId: ticketId, ticketBId: candidate.id }] },
    });
    if (exists) continue;

    const type = kwScore >= DEDUP_DUPLICATE_THRESHOLD ? "DUPLICATE" : "RELATED";
    const matchedTerms = getMatchedTerms(ticketText, candidateText);

    await prisma.ticketLink.create({
      data: { ticketAId: candidate.id, ticketBId: ticketId, type, confidence: kwScore, detectedBy: "auto", status: "suggested", metadata: { keywordScore: kwScore, matchedTerms } },
    });

    sseBus.publish(`sac:${ticket.companyId}`, "ticket-link-suggested", { ticketAId: candidate.id, ticketBId: ticketId, type, confidence: kwScore });
    results.push({ ticketAId: candidate.id, ticketBId: ticketId, type, confidence: kwScore, metadata: { keywordScore: kwScore, matchedTerms } });
    logger.info({ ticketAId: candidate.id, ticketBId: ticketId, type, confidence: kwScore }, "[dedup] Link created");
  }
  return results;
}
