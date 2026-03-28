const STOP_WORDS = new Set([
  "a", "o", "e", "de", "da", "do", "em", "um", "uma", "para", "com",
  "nao", "que", "por", "no", "na", "os", "as", "se", "mais", "foi",
  "como", "mas", "ao", "ele", "ela", "das", "dos", "seu", "sua",
  "ou", "ser", "esta", "isso", "nos", "nas",
  "the", "is", "at", "which", "on", "and", "or", "to", "in", "for",
  "of", "with", "this", "that", "from", "are", "was", "has", "have",
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractKeywords(text: string): Set<string> {
  const normalized = normalizeText(text);
  return new Set(
    normalized.split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

export function keywordSimilarity(text1: string, text2: string): number {
  const words1 = extractKeywords(text1);
  const words2 = extractKeywords(text2);
  if (words1.size === 0 && words2.size === 0) return 0;
  const intersection = [...words1].filter((w) => words2.has(w));
  const unionSize = new Set([...words1, ...words2]).size;
  return unionSize > 0 ? intersection.length / unionSize : 0;
}

export function getMatchedTerms(text1: string, text2: string): string[] {
  const words1 = extractKeywords(text1);
  const words2 = extractKeywords(text2);
  return [...words1].filter((w) => words2.has(w));
}
