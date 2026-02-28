"use strict";

/**
 * Remove non-digit characters from a CNPJ string.
 */
export function stripCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, "");
}

/**
 * Format a digits-only CNPJ string into XX.XXX.XXX/XXXX-XX.
 */
export function formatCnpj(cnpj: string): string {
  const digits = stripCnpj(cnpj);
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

/**
 * Validate a CNPJ (Brazilian company registration number).
 * Accepts both formatted (XX.XXX.XXX/XXXX-XX) and digits-only input.
 * Validates format length and check digits.
 */
export function isValidCnpj(cnpj: string): boolean {
  const digits = stripCnpj(cnpj);

  if (digits.length !== 14) return false;

  // Reject all-same-digit CNPJs (e.g. 00000000000000)
  if (/^(\d)\1{13}$/.test(digits)) return false;

  // Validate first check digit
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i]) * weights1[i];
  }
  let remainder = sum % 11;
  const check1 = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(digits[12]) !== check1) return false;

  // Validate second check digit
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(digits[i]) * weights2[i];
  }
  remainder = sum % 11;
  const check2 = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(digits[13]) !== check2) return false;

  return true;
}
