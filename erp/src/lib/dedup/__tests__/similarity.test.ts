import { describe, it, expect } from "vitest";
import { normalizeText, extractKeywords, keywordSimilarity, getMatchedTerms } from "../similarity";

describe("normalizeText", () => {
  it("lowercases text", () => { expect(normalizeText("HELLO World")).toBe("hello world"); });
  it("strips accents", () => { expect(normalizeText("café résumé")).toBe("cafe resume"); });
  it("strips punctuation", () => { expect(normalizeText("hello, world! #123")).toBe("hello world 123"); });
  it("collapses whitespace", () => { expect(normalizeText("  hello   world  ")).toBe("hello world"); });
  it("handles empty string", () => { expect(normalizeText("")).toBe(""); });
});

describe("extractKeywords", () => {
  it("extracts words longer than 3 chars", () => {
    const kw = extractKeywords("a big test of the system");
    expect(kw.has("test")).toBe(true);
    expect(kw.has("system")).toBe(true);
    expect(kw.has("big")).toBe(false);
  });
  it("excludes stop words", () => { expect(extractKeywords("para isso mais como").size).toBe(0); });
  it("handles Portuguese text", () => {
    const kw = extractKeywords("Preciso da segunda via do boleto NF 4521");
    expect(kw.has("preciso")).toBe(true);
    expect(kw.has("boleto")).toBe(true);
    expect(kw.has("4521")).toBe(true);
  });
});

describe("keywordSimilarity", () => {
  it("returns 1 for identical texts", () => {
    expect(keywordSimilarity("preciso da segunda via do boleto", "preciso da segunda via do boleto")).toBe(1);
  });
  it("returns 0 for different texts", () => {
    expect(keywordSimilarity("preciso segunda boleto", "reuniao amanha escritorio")).toBe(0);
  });
  it("returns 0 for empty strings", () => { expect(keywordSimilarity("", "")).toBe(0); });
  it("returns partial score for overlap", () => {
    const score = keywordSimilarity("Preciso da segunda via do boleto NF 4521", "Boleto NF 4521 vencido desde ontem");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
  it("reasonable score for same problem", () => {
    const score = keywordSimilarity("Preciso da segunda via do boleto NF 4521", "boleto NF 4521 que venceu ontem");
    expect(score).toBeGreaterThanOrEqual(0.2);
  });
  it("low similarity for different subjects", () => {
    expect(keywordSimilarity("Preciso da segunda via do boleto NF 4521", "Quero cancelar minha assinatura do plano premium")).toBeLessThan(0.2);
  });
});

describe("getMatchedTerms", () => {
  it("returns common keywords", () => {
    const terms = getMatchedTerms("Preciso do boleto NF 4521", "Boleto NF 4521 vencido");
    expect(terms).toContain("boleto");
    expect(terms).toContain("4521");
  });
  it("returns empty for no overlap", () => {
    expect(getMatchedTerms("reuniao amanha escritorio", "preciso segunda boleto")).toEqual([]);
  });
});
