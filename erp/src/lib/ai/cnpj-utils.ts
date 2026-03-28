// ─── CNPJ / CPF utilities ────────────────────────────────────────────────────
//
// Extraction, validation and formatting helpers used by the AI agent tools
// and inbound workers to unify client identification by CNPJ/CPF.

/**
 * Regex that matches CNPJ in formatted (XX.XXX.XXX/XXXX-XX) or raw (14 digits) form.
 * Uses word-boundary anchors to avoid partial matches inside longer numbers.
 */
const CNPJ_REGEX = /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/g;

/**
 * Extract all CNPJ-like strings from arbitrary text, returning unique normalised values.
 */
export function extractCnpjs(text: string): string[] {
  const matches = text.match(CNPJ_REGEX) || [];
  return Array.from(new Set(matches.map(normalizeCnpj)));
}

/**
 * Strip non-digit characters so we always work with a plain numeric string.
 */
export function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Full CNPJ validation including check-digit verification per Receita Federal algorithm.
 * Rejects strings that are not exactly 14 digits or consist of a single repeated digit.
 */
export function isValidCnpj(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  // All same digit is technically invalid (e.g. 11111111111111)
  if (/^(\d)\1{13}$/.test(digits)) return false;

  // First check digit
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i]) * weights1[i];
  }
  let remainder = sum % 11;
  const digit1 = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(digits[12]) !== digit1) return false;

  // Second check digit
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(digits[i]) * weights2[i];
  }
  remainder = sum % 11;
  const digit2 = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(digits[13]) !== digit2) return false;

  return true;
}

/**
 * Format a numeric CNPJ (14 digits) or CPF (11 digits) into its canonical
 * human-readable representation.
 */
export function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "");
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return cnpj;
}
