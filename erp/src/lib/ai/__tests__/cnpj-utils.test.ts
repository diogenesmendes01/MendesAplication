/**
 * Unit tests for CNPJ/CPF utility functions.
 * Tests extraction, validation (including check-digit verification), normalisation and formatting.
 */
import { describe, it, expect } from "vitest";
import {
  extractCnpjs,
  normalizeCnpj,
  isValidCnpj,
  formatCnpj,
} from "@/lib/ai/cnpj-utils";

// ─── normalizeCnpj ──────────────────────────────────────────────────────────

describe("normalizeCnpj", () => {
  it("strips dots, slash, and dash from formatted CNPJ", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("returns raw digits unchanged", () => {
    expect(normalizeCnpj("11222333000181")).toBe("11222333000181");
  });
});

// ─── isValidCnpj ────────────────────────────────────────────────────────────

describe("isValidCnpj", () => {
  // Known valid CNPJs (check digits calculated correctly)
  const validCnpjs = [
    "11222333000181",
    "11444777000161",
    "00000000000191", // edge case: starts with zeros, but valid check digits
  ];

  it.each(validCnpjs)("accepts valid CNPJ %s", (cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(true);
  });

  it("accepts formatted CNPJ", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  });

  it("rejects CNPJ with wrong check digits", () => {
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11222333000100")).toBe(false);
  });

  it("rejects all-same-digit CNPJs", () => {
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("99999999999999")).toBe(false);
  });

  it("rejects strings that are not 14 digits", () => {
    expect(isValidCnpj("1234567890")).toBe(false);
    expect(isValidCnpj("123456789012345")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });
});

// ─── extractCnpjs ───────────────────────────────────────────────────────────

describe("extractCnpjs", () => {
  it("extracts formatted CNPJ from text", () => {
    const text = "O CNPJ é 11.222.333/0001-81 conforme o documento.";
    expect(extractCnpjs(text)).toEqual(["11222333000181"]);
  });

  it("extracts raw 14-digit CNPJ from text", () => {
    const text = "CNPJ 11222333000181 identificado";
    expect(extractCnpjs(text)).toEqual(["11222333000181"]);
  });

  it("extracts multiple CNPJs and deduplicates", () => {
    const text = "CNPJs: 11.222.333/0001-81 e 11222333000181 e 44.555.666/0001-20";
    const result = extractCnpjs(text);
    // First two are the same after normalisation
    expect(result).toContain("11222333000181");
    expect(result).toContain("44555666000120");
    expect(result.length).toBe(2);
  });

  it("returns empty array when no CNPJ found", () => {
    expect(extractCnpjs("Olá, preciso de ajuda")).toEqual([]);
  });

  it("does not match partial numbers", () => {
    // 10-digit number should not match
    expect(extractCnpjs("Protocolo: 1234567890")).toEqual([]);
  });
});

// ─── formatCnpj ─────────────────────────────────────────────────────────────

describe("formatCnpj", () => {
  it("formats 14-digit CNPJ", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("formats 11-digit CPF", () => {
    expect(formatCnpj("12345678901")).toBe("123.456.789-01");
  });

  it("returns input unchanged if not 11 or 14 digits", () => {
    expect(formatCnpj("12345")).toBe("12345");
  });
});
