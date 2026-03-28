/**
 * AI Audit Trail — Records detailed reasoning and tool call data for each
 * agent iteration, enabling "Why did the AI do this?" explainability.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ChannelType } from "@prisma/client";

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface AuditTrailEntry {
  ticketId: string;
  messageId?: string;
  responseMessageId?: string;
  companyId: string;
  channel: ChannelType;
  iteration: number;
  input: string;
  reasoning?: string;
  toolCalls: ToolCallRecord[];
  output?: string;
  decision: string;
  confidence: number;
  inputTokens: number;
  outputTokens: number;
  costBrl: number;
  durationMs: number;
  provider: string;
  model: string;
}

export async function recordAuditTrail(entry: AuditTrailEntry): Promise<string | null> {
  try {
    const config = await prisma.aiConfig.findFirst({
      where: { companyId: entry.companyId, channel: entry.channel },
      select: { auditTrailEnabled: true },
    });
    const globalConfig = config ?? await prisma.aiConfig.findFirst({
      where: { companyId: entry.companyId, channel: null },
      select: { auditTrailEnabled: true },
    });
    if (globalConfig && !globalConfig.auditTrailEnabled) return null;

    const record = await prisma.aiAuditTrail.create({
      data: {
        ticketId: entry.ticketId,
        messageId: entry.messageId || null,
        responseMessageId: entry.responseMessageId || null,
        companyId: entry.companyId,
        channel: entry.channel,
        iteration: entry.iteration,
        input: entry.input,
        reasoning: entry.reasoning || null,
        toolCalls: entry.toolCalls.map((tc) => ({
          tool: tc.tool, args: tc.args,
          result: tc.result.substring(0, 500),
          durationMs: tc.durationMs,
        })),
        output: entry.output || null,
        decision: entry.decision,
        confidence: entry.confidence,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        costBrl: entry.costBrl,
        durationMs: entry.durationMs,
        provider: entry.provider,
        model: entry.model,
      },
    });
    return record.id;
  } catch (err) {
    logger.error({ err, ticketId: entry.ticketId }, "[audit-trail] Failed to record");
    return null;
  }
}

export async function getAuditTrail(ticketId: string, companyId: string) {
  return prisma.aiAuditTrail.findMany({
    where: { ticketId, companyId, isArchived: false },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, ticketId: true, messageId: true, responseMessageId: true,
      channel: true, iteration: true, input: true, reasoning: true,
      toolCalls: true, output: true, decision: true, confidence: true,
      inputTokens: true, outputTokens: true, costBrl: true, durationMs: true,
      provider: true, model: true, createdAt: true,
    },
  });
}

export async function getAuditEntry(id: string, companyId: string) {
  return prisma.aiAuditTrail.findFirst({ where: { id, companyId } });
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export async function exportAuditTrailCSV(ticketId: string, companyId: string): Promise<string> {
  const trails = await prisma.aiAuditTrail.findMany({
    where: { ticketId, companyId, isArchived: false },
    orderBy: { createdAt: "asc" },
  });
  const headers = [
    "timestamp","iteration","input","reasoning","tools_called",
    "output","decision","confidence","tokens_in","tokens_out",
    "cost_brl","duration_ms","provider","model",
  ];
  const rows = trails.map((t) => [
    t.createdAt.toISOString(), String(t.iteration),
    csvEscape(t.input), csvEscape(t.reasoning || ""),
    csvEscape((t.toolCalls as ToolCallRecord[]).map((tc) => tc.tool).join("; ")),
    csvEscape(t.output || ""), t.decision, t.confidence.toFixed(2),
    String(t.inputTokens), String(t.outputTokens),
    Number(t.costBrl).toFixed(6), String(t.durationMs), t.provider, t.model,
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export async function exportAuditTrailJSON(ticketId: string, companyId: string): Promise<string> {
  const trails = await getAuditTrail(ticketId, companyId);
  return JSON.stringify(trails, null, 2);
}

export async function cleanupAuditTrails(): Promise<{ archived: number; deleted: number }> {
  let totalArchived = 0;
  let totalDeleted = 0;
  const configs = await prisma.aiConfig.findMany({
    where: { auditRetentionDays: { gt: 0 } },
    select: { companyId: true, auditRetentionDays: true },
    distinct: ["companyId"],
  });
  for (const config of configs) {
    const cutoff = new Date(Date.now() - config.auditRetentionDays * 24 * 60 * 60 * 1000);
    const archived = await prisma.aiAuditTrail.updateMany({
      where: { companyId: config.companyId, createdAt: { lt: cutoff }, isArchived: false },
      data: { isArchived: true },
    });
    totalArchived += archived.count;
    const hardDeleteCutoff = new Date(Date.now() - config.auditRetentionDays * 2 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.aiAuditTrail.deleteMany({
      where: { companyId: config.companyId, createdAt: { lt: hardDeleteCutoff }, isArchived: true },
    });
    totalDeleted += deleted.count;
  }
  if (totalArchived > 0 || totalDeleted > 0) {
    logger.info({ archived: totalArchived, deleted: totalDeleted }, "[audit-cleanup] Cleanup complete");
  }
  return { archived: totalArchived, deleted: totalDeleted };
}
