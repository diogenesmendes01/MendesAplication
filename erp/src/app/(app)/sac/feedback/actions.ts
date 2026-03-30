"use server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireCompanyAccess } from "@/lib/rbac";
import { withLogging } from "@/lib/with-logging";

export interface FeedbackSummary { total: number; positive: number; correction: number; negative: number; approvalRate: number; editRate: number; rejectionRate: number; byCategory: Array<{ category: string; count: number }>; byChannel: Array<{ channel: string; count: number }>; }
export interface RejectReason { reason: string; count: number; category: string | null; examples: string[]; }
export interface EditPattern { avgChangePercent: number; totalEdits: number; minorEdits: number; majorEdits: number; topChanges: Array<{ originalSnippet: string; editedSnippet: string; changePercent: number }>; }
export interface ConfidenceCalibration { bucket: string; range: [number, number]; total: number; approved: number; rejected: number; edited: number; approvalRate: number; }

async function _getFeedbackSummary(companyId: string, from?: string, to?: string): Promise<FeedbackSummary> {
  await requireCompanyAccess(companyId);
  const dateFilter: Record<string, unknown> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);
  const where = { companyId, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) };
  const feedbacks = await prisma.aiFeedback.findMany({ where, select: { type: true, category: true, channel: true } });
  const total = feedbacks.length;
  const positive = feedbacks.filter((f) => f.type === "positive").length;
  const correction = feedbacks.filter((f) => f.type === "correction").length;
  const negative = feedbacks.filter((f) => f.type === "negative").length;
  const catMap = new Map<string, number>();
  for (const f of feedbacks) { const cat = f.category || "uncategorized"; catMap.set(cat, (catMap.get(cat) || 0) + 1); }
  const byCategory = Array.from(catMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
  const chanMap = new Map<string, number>();
  for (const f of feedbacks) { chanMap.set(f.channel, (chanMap.get(f.channel) || 0) + 1); }
  const byChannel = Array.from(chanMap.entries()).map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count);
  return { total, positive, correction, negative, approvalRate: total > 0 ? positive / total : 0, editRate: total > 0 ? correction / total : 0, rejectionRate: total > 0 ? negative / total : 0, byCategory, byChannel };
}

async function _getRejectReasons(companyId: string, from?: string, to?: string): Promise<RejectReason[]> {
  await requireCompanyAccess(companyId);
  const dateFilter: Record<string, unknown> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);
  const feedbacks = await prisma.aiFeedback.findMany({ where: { companyId, type: "negative", ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) }, select: { rejectionReason: true, category: true, originalResponse: true }, orderBy: { createdAt: "desc" }, take: 200 });
  const reasonMap = new Map<string, { count: number; category: string | null; examples: string[] }>();
  for (const f of feedbacks) { const reason = f.rejectionReason || "Sem motivo informado"; const existing = reasonMap.get(reason); if (existing) { existing.count++; if (existing.examples.length < 3 && f.originalResponse) existing.examples.push(f.originalResponse.slice(0, 120)); } else { reasonMap.set(reason, { count: 1, category: f.category, examples: f.originalResponse ? [f.originalResponse.slice(0, 120)] : [] }); } }
  return Array.from(reasonMap.entries()).map(([reason, data]) => ({ reason, ...data })).sort((a, b) => b.count - a.count);
}

async function _getEditPatterns(companyId: string, from?: string, to?: string): Promise<EditPattern> {
  await requireCompanyAccess(companyId);
  const dateFilter: Record<string, unknown> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);
  const feedbacks = await prisma.aiFeedback.findMany({ where: { companyId, type: "correction", diff: { not: Prisma.DbNull }, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) }, select: { diff: true, originalResponse: true, editedResponse: true }, orderBy: { createdAt: "desc" }, take: 200 });
  const totalEdits = feedbacks.length; let totalChangePercent = 0; let minorEdits = 0; let majorEdits = 0;
  const topChanges: EditPattern["topChanges"] = [];
  for (const f of feedbacks) { const diff = f.diff as Record<string, unknown> | null; if (!diff) continue; const cp = (diff.changePercent as number) || 0; totalChangePercent += cp; if (diff.isMinorEdit) minorEdits++; else majorEdits++; if (topChanges.length < 10 && f.originalResponse && f.editedResponse) topChanges.push({ originalSnippet: f.originalResponse.slice(0, 150), editedSnippet: f.editedResponse.slice(0, 150), changePercent: cp }); }
  topChanges.sort((a, b) => b.changePercent - a.changePercent);
  return { avgChangePercent: totalEdits > 0 ? Math.round((totalChangePercent / totalEdits) * 100) / 100 : 0, totalEdits, minorEdits, majorEdits, topChanges: topChanges.slice(0, 5) };
}

async function _getConfidenceCalibration(companyId: string, from?: string, to?: string): Promise<ConfidenceCalibration[]> {
  await requireCompanyAccess(companyId);
  const dateFilter: Record<string, unknown> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);
  const feedbacks = await prisma.aiFeedback.findMany({ where: { companyId, suggestionId: { not: null }, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) }, select: { type: true, suggestion: { select: { confidence: true } } } });
  const buckets: Array<{ label: string; range: [number, number] }> = [{ label: "0-20%", range: [0, 0.2] },{ label: "20-40%", range: [0.2, 0.4] },{ label: "40-60%", range: [0.4, 0.6] },{ label: "60-80%", range: [0.6, 0.8] },{ label: "80-100%", range: [0.8, 1.01] }];
  return buckets.map(({ label, range }) => { const ib = feedbacks.filter((f) => { const c = f.suggestion?.confidence ?? 0; return c >= range[0] && c < range[1]; }); const t = ib.length; return { bucket: label, range, total: t, approved: ib.filter((f) => f.type === "positive").length, rejected: ib.filter((f) => f.type === "negative").length, edited: ib.filter((f) => f.type === "correction").length, approvalRate: t > 0 ? ib.filter((f) => f.type === "positive").length / t : 0 }; });
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
export const getFeedbackSummary = withLogging('sac.feedback.getFeedbackSummary', _getFeedbackSummary);
export const getRejectReasons = withLogging('sac.feedback.getRejectReasons', _getRejectReasons);
export const getEditPatterns = withLogging('sac.feedback.getEditPatterns', _getEditPatterns);
export const getConfidenceCalibration = withLogging('sac.feedback.getConfidenceCalibration', _getConfidenceCalibration);
