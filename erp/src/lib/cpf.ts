"use strict";

/**
 * Remove non-digit characters from a CPF string.
 */
export function stripCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

/**
 * Format a digits-only CPF string into XXX.XXX.XXX-XX.
 */
export function formatCpf(cpf: string): string {
  const digits = stripCpf(cpf);
  return digits.replace(
    /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
    "$1.$2.$3-$4"
  );
}

/**
 * Validate a CPF (Brazilian individual registration number).
 * Accepts both formatted (XXX.XXX.XXX-XX) and digits-only input.
 * Validates format length and check digits.
 */
export function isValidCpf(cpf: string): boolean {
  const digits = stripCpf(cpf);

  if (digits.length !== 11) return false;

  // Reject all-same-digit CPFs (e.g. 00000000000)
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // Validate first check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (parseInt(digits[9]) !== remainder) return false;

  // Validate second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (parseInt(digits[10]) !== remainder) return false;

  return true;
}
