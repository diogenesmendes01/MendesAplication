// ─── Embedding Utility Functions ─────────────────────────────────────────────
// Pure utility functions — NOT server actions.
// Kept separate from embeddings.ts so that "use server" only wraps async exports.

const RAG_CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || "500", 10);

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
        if (
          (currentChunk + " " + sentence).length > maxChars &&
          currentChunk.trim()
        ) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk = currentChunk
            ? currentChunk + " " + sentence
            : sentence;
        }
      }
      continue;
    }

    if (
      (currentChunk + "\n\n" + trimmed).length > maxChars &&
      currentChunk.trim()
    ) {
      chunks.push(currentChunk.trim());
      currentChunk = trimmed;
    } else {
      currentChunk = currentChunk
        ? currentChunk + "\n\n" + trimmed
        : trimmed;
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
