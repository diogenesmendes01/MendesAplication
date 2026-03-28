"use server";

import { prisma } from "@/lib/prisma";
import type { ChannelType } from "@prisma/client";
import { requireSession } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { chunkText, cosineSimilarity } from "@/lib/ai/embedding-utils";
import { logger } from "@/lib/logger";

export interface KBDocument {
  id: string; name: string; content: string | null; mimeType: string; fileSize: number;
  status: string; channel: string | null; category: string | null; tags: string[];
  sourceType: string; sourceFile: string | null; isActive: boolean; version: number;
  createdById: string | null; updatedById: string | null; createdAt: Date; updatedAt: Date;
  _count?: { chunks: number };
}
export interface KBChunk { id: string; content: string; chunkIndex: number; createdAt: Date; tokenEstimate: number; }
export interface KBSearchResult { documentId: string; documentName: string; category: string | null; chunkContent: string; chunkIndex: number; similarity: number; }
export interface KBVersion { id: string; version: number; title: string; content: string; category: string | null; tags: string[]; changedBy: string | null; changeNote: string | null; createdAt: Date; }
export interface KBStats { totalDocuments: number; totalChunks: number; activeDocuments: number; categories: string[]; lastUpdated: Date | null; }

async function requireCompanyAuth(companyId: string) {
  const session = await requireSession();
  if (!(await canAccessCompany(session.userId, session.role, companyId))) throw new Error("Acesso negado a esta empresa");
  return session;
}

export async function listDocuments(companyId: string, filters?: { category?: string; tag?: string; search?: string; channel?: string | null; includeInactive?: boolean }): Promise<KBDocument[]> {
  await requireCompanyAuth(companyId);
  const where: Record<string, unknown> = { companyId };
  if (!filters?.includeInactive) where.isActive = true;
  if (filters?.category) where.category = filters.category;
  if (filters?.tag) where.tags = { has: filters.tag };
  if (filters?.search) where.name = { contains: filters.search, mode: "insensitive" };
  if (filters?.channel !== undefined) where.channel = filters.channel;
  return (await prisma.document.findMany({ where, orderBy: { updatedAt: "desc" }, include: { _count: { select: { chunks: true } } } })) as unknown as KBDocument[];
}

export async function createDocument(companyId: string, data: { name: string; content: string; category?: string; tags?: string[]; channel?: string | null }): Promise<KBDocument> {
  const session = await requireCompanyAuth(companyId);
  const doc = await prisma.document.create({ data: { companyId, name: data.name, content: data.content, mimeType: "text/markdown", fileSize: Buffer.from(data.content, "utf-8").length, status: "PROCESSING", channel: (data.channel ?? null) as ChannelType | null, category: data.category || null, tags: data.tags || [], sourceType: "manual", isActive: true, version: 1, createdById: session.userId, updatedById: session.userId } });
  await prisma.documentVersion.create({ data: { documentId: doc.id, version: 1, title: data.name, content: data.content, category: data.category || null, tags: data.tags || [], changedBy: session.userId, changeNote: "Criacao inicial" } });
  await processDocumentChunks(doc.id, data.content);
  return doc as unknown as KBDocument;
}

export async function updateDocument(companyId: string, documentId: string, data: { name?: string; content?: string; category?: string; tags?: string[]; changeNote?: string }): Promise<KBDocument> {
  const session = await requireCompanyAuth(companyId);
  const current = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!current) throw new Error("Documento nao encontrado");
  const newVersion = (current.version ?? 1) + 1;
  await prisma.documentVersion.create({ data: { documentId, version: current.version ?? 1, title: current.name, content: current.content || "", category: current.category, tags: current.tags || [], changedBy: session.userId, changeNote: data.changeNote || "Atualizacao v" + newVersion } });
  const newContent = data.content ?? current.content;
  const contentChanged = data.content !== undefined && data.content !== current.content;
  const updated = await prisma.document.update({ where: { id: documentId }, data: { name: data.name ?? current.name, content: newContent, category: data.category !== undefined ? data.category : current.category, tags: data.tags ?? current.tags, version: newVersion, fileSize: newContent ? Buffer.from(newContent, "utf-8").length : current.fileSize, updatedById: session.userId } });
  if (contentChanged && newContent) await processDocumentChunks(documentId, newContent);
  return updated as unknown as KBDocument;
}

export async function deleteDocument(companyId: string, documentId: string, hard: boolean = false): Promise<void> {
  await requireCompanyAuth(companyId);
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!doc) throw new Error("Documento nao encontrado");
  if (hard) await prisma.document.delete({ where: { id: documentId } });
  else await prisma.document.update({ where: { id: documentId }, data: { isActive: false } });
}

export async function getDocumentChunks(companyId: string, documentId: string): Promise<KBChunk[]> {
  await requireCompanyAuth(companyId);
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!doc) throw new Error("Documento nao encontrado");
  const chunks = await prisma.documentChunk.findMany({ where: { documentId }, orderBy: { chunkIndex: "asc" }, select: { id: true, content: true, chunkIndex: true, createdAt: true } });
  return chunks.map((c) => ({ ...c, tokenEstimate: Math.ceil(c.content.length / 4) }));
}

export async function searchKnowledge(companyId: string, query: string, limit: number = 5): Promise<KBSearchResult[]> {
  await requireCompanyAuth(companyId);
  if (!query.trim()) return [];
  const queryEmbedding = await generateEmbedding(query);
  const chunks = await prisma.documentChunk.findMany({ where: { document: { companyId, isActive: true, status: "READY" } }, include: { document: { select: { id: true, name: true, category: true } } } });
  if (chunks.length === 0) return [];
  return chunks.filter((c) => c.embedding && c.embedding.length > 0).map((chunk) => ({ documentId: chunk.document.id, documentName: chunk.document.name, category: chunk.document.category, chunkContent: chunk.content, chunkIndex: chunk.chunkIndex, similarity: Math.round(cosineSimilarity(queryEmbedding, chunk.embedding) * 100) })).filter((r) => r.similarity >= 50).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

export async function getDocumentVersions(companyId: string, documentId: string): Promise<KBVersion[]> {
  await requireCompanyAuth(companyId);
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!doc) throw new Error("Documento nao encontrado");
  return (await prisma.documentVersion.findMany({ where: { documentId }, orderBy: { version: "desc" } })) as KBVersion[];
}

export async function restoreVersion(companyId: string, documentId: string, targetVersion: number): Promise<KBDocument> {
  await requireCompanyAuth(companyId);
  const version = await prisma.documentVersion.findFirst({ where: { documentId, version: targetVersion } });
  if (!version) throw new Error("Versao nao encontrada");
  return updateDocument(companyId, documentId, { name: version.title, content: version.content, category: version.category || undefined, tags: version.tags, changeNote: "Restaurado da v" + targetVersion });
}

export async function getKBStats(companyId: string): Promise<KBStats> {
  await requireCompanyAuth(companyId);
  const [totalDocs, activeDocs, totalChunks, lastDoc, categories] = await Promise.all([
    prisma.document.count({ where: { companyId } }),
    prisma.document.count({ where: { companyId, isActive: true } }),
    prisma.documentChunk.count({ where: { document: { companyId, isActive: true } } }),
    prisma.document.findFirst({ where: { companyId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.document.findMany({ where: { companyId, isActive: true, category: { not: null } }, select: { category: true }, distinct: ["category"] }),
  ]);
  return { totalDocuments: totalDocs, activeDocuments: activeDocs, totalChunks, lastUpdated: lastDoc?.updatedAt || null, categories: categories.map((c) => c.category!).filter(Boolean).sort() };
}

export async function getAllTags(companyId: string): Promise<string[]> {
  await requireCompanyAuth(companyId);
  const docs = await prisma.document.findMany({ where: { companyId, isActive: true }, select: { tags: true } });
  const tagSet = new Set<string>();
  for (const doc of docs) for (const tag of doc.tags) tagSet.add(tag);
  return Array.from(tagSet).sort();
}

export async function uploadAndExtractText(formData: FormData): Promise<{ extractedText: string; fileName: string; mimeType: string }> {
  await requireSession();
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("Nenhum arquivo enviado");
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type;
  let extractedText = "";
  if (mimeType === "application/pdf") { const pdfParse = (await import("pdf-parse") as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default; extractedText = (await pdfParse(buffer)).text; }
  else if (mimeType === "text/plain" || mimeType === "text/csv") { extractedText = buffer.toString("utf-8"); }
  else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "application/msword") { const mammoth = await import("mammoth"); extractedText = (await mammoth.extractRawText({ buffer })).value; }
  else if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mimeType === "application/vnd.ms-excel") { const XLSX = await import("xlsx"); const wb = XLSX.read(buffer, { type: "buffer" }); extractedText = wb.SheetNames.map((n) => { const s = wb.Sheets[n]; return "=== " + n + " ===\n" + XLSX.utils.sheet_to_csv(s); }).join("\n\n"); }
  else throw new Error("Tipo nao suportado: " + mimeType);
  return { extractedText: extractedText.trim(), fileName: file.name, mimeType };
}

export async function rechunkDocument(companyId: string, documentId: string, chunkSize?: number): Promise<{ chunksCreated: number }> {
  await requireCompanyAuth(companyId);
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!doc || !doc.content) throw new Error("Documento nao encontrado ou sem conteudo");
  return { chunksCreated: await processDocumentChunks(documentId, doc.content, chunkSize) };
}

async function processDocumentChunks(documentId: string, content: string, chunkSize?: number): Promise<number> {
  try {
    await prisma.documentChunk.deleteMany({ where: { documentId } });
    const textChunks = chunkText(content, chunkSize);
    if (textChunks.length === 0) { await prisma.document.update({ where: { id: documentId }, data: { status: "READY" } }); return 0; }
    for (let i = 0; i < textChunks.length; i++) {
      try { const embedding = await generateEmbedding(textChunks[i]); await prisma.documentChunk.create({ data: { documentId, content: textChunks[i], embedding, chunkIndex: i } }); }
      catch (err) { logger.error("Embedding error chunk " + i + " " + String(err)); await prisma.documentChunk.create({ data: { documentId, content: textChunks[i], embedding: [], chunkIndex: i } }); }
    }
    await prisma.document.update({ where: { id: documentId }, data: { status: "READY" } });
    return textChunks.length;
  } catch (err) { logger.error("Error processing " + documentId + " " + String(err)); await prisma.document.update({ where: { id: documentId }, data: { status: "ERROR" } }); throw err; }
}
