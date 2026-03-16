import { describe, it, expect } from "vitest";
import { chunkText, cosineSimilarity } from "../embedding-utils";

// ─── chunkText ────────────────────────────────────────────────────────────────

describe("chunkText", () => {
  it("returns [] for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns [] for whitespace-only string", () => {
    expect(chunkText("   \n  \t  ")).toEqual([]);
  });

  it("returns single chunk when text fits within limit", () => {
    const text = "Hello world. This is a short text.";
    const result = chunkText(text, 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text.trim());
  });

  it("splits text into multiple chunks when it exceeds limit", () => {
    // maxTokens=5 → maxChars=20; paragraphs are ~22 chars each — should split
    const text = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.";
    const result = chunkText(text, 5);
    expect(result.length).toBeGreaterThan(1);
    // All original content must be preserved across chunks
    const rejoined = result.join(" ");
    expect(rejoined).toContain("First paragraph");
    expect(rejoined).toContain("Second paragraph");
    expect(rejoined).toContain("Third paragraph");
  });

  it("handles a single paragraph larger than maxChars by splitting on sentences", () => {
    // maxTokens=5 → maxChars=20
    // Single block with no blank lines — forces sentence splitting path
    // Note: individual sentences may still exceed maxChars (best-effort split)
    const text =
      "First sentence here! Second sentence there. Third sentence around.";
    const result = chunkText(text, 5);
    expect(result.length).toBeGreaterThan(1);
    // All content preserved (join and compare cleaned up)
    const joined = result.join(" ").replace(/\s+/g, " ").trim();
    const original = text.replace(/\s+/g, " ").trim();
    expect(joined).toBe(original);
  });

  it("preserves content across chunks (no data loss)", () => {
    const para1 = "Alpha beta gamma delta epsilon.";
    const para2 = "Zeta eta theta iota kappa lambda.";
    const text = `${para1}\n\n${para2}`;
    const result = chunkText(text, 10); // maxChars=40 — each para ~30 chars, fits in one
    const rejoined = result.join("\n\n");
    expect(rejoined).toContain("Alpha");
    expect(rejoined).toContain("Zeta");
  });

  it("trims chunks so no chunk starts or ends with whitespace", () => {
    const text = "  Para one.  \n\n  Para two.  \n\n  Para three.  ";
    const result = chunkText(text, 100);
    for (const chunk of result) {
      expect(chunk).toBe(chunk.trim());
    }
  });

  it("uses RAG_CHUNK_SIZE default when maxTokens is omitted", () => {
    const shortText = "Short.";
    const result = chunkText(shortText);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(shortText);
  });
});

// ─── cosineSimilarity ────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("throws when vectors have different lengths", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });
});
