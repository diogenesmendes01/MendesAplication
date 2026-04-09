import type { EmitNfseInput } from "../nfse";

/**
 * Extract rpsNumero from input, using Date.now() as fallback for legacy callers.
 *
 * The rpsNumero should ideally be generated atomically via database (FiscalConfig.nfseNextNumber)
 * to avoid collisions in simultaneous emissions. This fallback is for backward compatibility
 * with legacy callers that don't pass the field.
 *
 * @param input - The emission input containing optional rpsNumero
 * @returns string representation of rpsNumero
 */
export function getRpsNumero(input: EmitNfseInput): string {
  if (input.rpsNumero) {
    return input.rpsNumero;
  }
  // Fallback to Date.now() for legacy callers
  return Date.now().toString();
}

/**
 * Extract rpsNumero from input with a custom slice length.
 *
 * Some providers require specific length RPS numbers (e.g., last 9 digits, last 12 digits).
 * This variant allows customizing the slice behavior while maintaining the same fallback pattern.
 *
 * @param input - The emission input containing optional rpsNumero
 * @param sliceLength - If provided, take only the last N characters of the fallback
 * @returns string representation of rpsNumero
 */
export function getRpsNumeroWithSlice(
  input: EmitNfseInput,
  sliceLength?: number
): string {
  if (input.rpsNumero) {
    return input.rpsNumero;
  }
  // Fallback to Date.now() for legacy callers
  const fallback = String(Date.now());
  if (sliceLength === undefined) {
    return fallback;
  }
  return fallback.slice(-sliceLength);
}
