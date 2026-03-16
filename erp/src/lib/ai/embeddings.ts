

"use server";

import { prisma } from "@/lib/prisma";

// ─── Configuration ──────────────────────────────────────────────────────────

const RAG_CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || "500", 10);
const RAG_MAX_RESULTS = parseInt(process.env.RAG_MAX_RESULTS || "5", 10);
const RAG_SIMILARITY_THRESHOLD = parseFloat(
  process.env.RAG_SIMILARITY_THRESHOLD || "0.7"
);

// ─── Embedding Generation ───────────────────────────────────────────────────

const EMBEDDING_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com",
};

const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: "text-embedding-3-small",
  deepseek: "text-embedding-3-small",
};

/**
 * Generates an embedding vector for the given text using the configured
 * embedding provider (AI_EMBEDDING_PROVIDER env).
 * Supports OpenAI-compatible APIs (openai, deepseek).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const provider = process.env.AI_EMBEDDING_PROVIDER || "openai";
  const apiKey = process.env.AI_EMBEDDING_KEY;
  if (!apiKey) {
    throw new Error(
      `AI_EMBEDDING_KEY nao configurada para provider ${provider}`
    );
  }

  const model =
    process.env.AI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODELS[provider] || "text-embedding-3-small";
  const baseUrl = EMBEDDING_BASE_URLS[provider] || EMBEDDING_BASE_URLS.openai;

  const res = await fetch(`${baseUrl}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Embedding API error ${res.status} (${provider}): ${errorBody}`
    );
  }

  const data = await res.json();
  const embedding: number[] = data?.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error(`Embedding API retornou resposta invalida (${provider})`);
  }

  return embedding;
}

// ─── Text Chunking ──────────────────────────────────────────────────────────

/**
 * Splits text into chunks of approximately `maxTokens` tokens.
 * Uses a rough heuristic of ~4 characters per token.
 * Tries to split on paragraph/sentence boundaries when possible.
 */
export function chunkText(text: string, maxTokens?: number): string[] {
  const tokenLimit = maxTokens || RAG_CHUNK_SIZE;
  const maxChars = tokenLimit * 4; // rough: ~4 chars per token

  if (!text || text.trim().length === 0) return [];
  if (text.length <= maxChars) return [text.trim()];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // If a single paragraph is too large, split by sentences
    if (trimmed.length > maxChars) {
      // Flush current chunk first
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      // Split large paragraph into sentences
      const sentences = trimmed.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if ((currentChunk + " " + sentence).length > maxChars && currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
        }
      }
      continue;
    }

    if ((currentChunk + "\n\n" + trimmed).length > maxChars && currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = trimmed;
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + trimmed : trimmed;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ─── Cosine Similarity ──────────────────────────────────────────────────────

/**
 * Calculates cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vetores de tamanhos diferentes: ${a.length} vs ${b.length}`
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ─── Document Search ────────────────────────────────────────────────────────

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  chunkIndex: number;
}

/**
 * Searches documents for the given query using embedding similarity.
 * 1. Generates embedding for the query
 * 2. Fetches all DocumentChunks for the company from Prisma
 * 3. Calculates cosine similarity in-memory
 * 4. Returns top N results above the similarity threshold
 */
export async function searchDocuments(
  query: string,
  companyId: string
): Promise<SearchResult[]> {
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // Fetch all chunks for the company (with document info)
  const chunks = await prisma.documentChunk.findMany({
    where: {
      document: {
        companyId,
        status: "READY",
      },
    },
    include: {
      document: {
        select: { id: true, name: true },
      },
    },
  });

  if (chunks.length === 0) return [];

  // Calculate similarity for each chunk
  const scored: SearchResult[] = [];

  for (const chunk of chunks) {
    if (!chunk.embedding || chunk.embedding.length === 0) continue;

    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);

    if (similarity >= RAG_SIMILARITY_THRESHOLD) {
      scored.push({
        chunkId: chunk.id,
        documentId: chunk.document.id,
        documentName: chunk.document.name,
        content: chunk.content,
        similarity,
        chunkIndex: chunk.chunkIndex,
      });
    }
  }

  // Sort by similarity descending, take top N
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, RAG_MAX_RESULTS);
}
