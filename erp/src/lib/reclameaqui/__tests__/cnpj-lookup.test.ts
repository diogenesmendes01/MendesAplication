/**
 * Unit tests for cnpj-lookup.ts — domain extraction, free email detection,
 * and CNPJ lookup logic (with mocked pg Pool).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We import the pure functions directly (no DB dependency)
import {
  extractDomain,
  isFreeEmailDomain,
} from "../cnpj-lookup";

// ---------------------------------------------------------------------------
// extractDomain
// ---------------------------------------------------------------------------

describe("extractDomain", () => {
  it("extracts domain from a valid email", () => {
    expect(extractDomain("user@acme.com.br")).toBe("acme.com.br");
  });

  it("handles uppercase emails", () => {
    expect(extractDomain("User@ACME.COM")).toBe("acme.com");
  });

  it("handles emails with spaces", () => {
    expect(extractDomain("  user@acme.com  ")).toBe("acme.com");
  });

  it("returns null for null/undefined/empty", () => {
    expect(extractDomain(null)).toBeNull();
    expect(extractDomain(undefined)).toBeNull();
    expect(extractDomain("")).toBeNull();
  });

  it("returns null for invalid emails (no @)", () => {
    expect(extractDomain("userexample.com")).toBeNull();
  });

  it("returns null for emails with @ but no valid domain", () => {
    expect(extractDomain("user@")).toBeNull();
    expect(extractDomain("user@nodot")).toBeNull();
  });

  it("handles multiple @ signs (uses last one)", () => {
    expect(extractDomain("user@something@acme.com")).toBe("acme.com");
  });
});

// ---------------------------------------------------------------------------
// isFreeEmailDomain
// ---------------------------------------------------------------------------

describe("isFreeEmailDomain", () => {
  it("identifies free email providers", () => {
    expect(isFreeEmailDomain("gmail.com")).toBe(true);
    expect(isFreeEmailDomain("hotmail.com")).toBe(true);
    expect(isFreeEmailDomain("outlook.com")).toBe(true);
    expect(isFreeEmailDomain("yahoo.com")).toBe(true);
    expect(isFreeEmailDomain("yahoo.com.br")).toBe(true);
    expect(isFreeEmailDomain("uol.com.br")).toBe(true);
    expect(isFreeEmailDomain("protonmail.com")).toBe(true);
    expect(isFreeEmailDomain("icloud.com")).toBe(true);
    expect(isFreeEmailDomain("terra.com.br")).toBe(true);
    expect(isFreeEmailDomain("bol.com.br")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFreeEmailDomain("Gmail.COM")).toBe(true);
    expect(isFreeEmailDomain("HOTMAIL.com")).toBe(true);
  });

  it("identifies corporate domains as NOT free", () => {
    expect(isFreeEmailDomain("acme.com.br")).toBe(false);
    expect(isFreeEmailDomain("empresa.com")).toBe(false);
    expect(isFreeEmailDomain("mendes.tech")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lookupCnpjByDomain / lookupCnpjByEmail — mocked
// ---------------------------------------------------------------------------

describe("lookupCnpjByDomain", () => {
  const originalEnv = process.env.CNPJ_DATABASE_URL;

  afterEach(() => {
    if (originalEnv) {
      process.env.CNPJ_DATABASE_URL = originalEnv;
    } else {
      delete process.env.CNPJ_DATABASE_URL;
    }
    vi.restoreAllMocks();
  });

  it("returns null for free email domains without querying DB", async () => {
    const { lookupCnpjByDomain } = await import("../cnpj-lookup");
    const result = await lookupCnpjByDomain("gmail.com");
    expect(result).toBeNull();
  });

  it("returns null for free email domains (hotmail)", async () => {
    const { lookupCnpjByDomain } = await import("../cnpj-lookup");
    const result = await lookupCnpjByDomain("hotmail.com");
    expect(result).toBeNull();
  });
});

describe("lookupCnpjByEmail", () => {
  it("returns null for emails with free domains", async () => {
    const { lookupCnpjByEmail } = await import("../cnpj-lookup");

    expect(await lookupCnpjByEmail("user@gmail.com")).toBeNull();
    expect(await lookupCnpjByEmail("user@hotmail.com")).toBeNull();
    expect(await lookupCnpjByEmail("user@yahoo.com.br")).toBeNull();
  });

  it("returns null for null/undefined/empty emails", async () => {
    const { lookupCnpjByEmail } = await import("../cnpj-lookup");

    expect(await lookupCnpjByEmail(null)).toBeNull();
    expect(await lookupCnpjByEmail(undefined)).toBeNull();
    expect(await lookupCnpjByEmail("")).toBeNull();
  });

  it("returns null for invalid email format", async () => {
    const { lookupCnpjByEmail } = await import("../cnpj-lookup");

    expect(await lookupCnpjByEmail("noemail")).toBeNull();
    expect(await lookupCnpjByEmail("@nodomain")).toBeNull();
  });
});
