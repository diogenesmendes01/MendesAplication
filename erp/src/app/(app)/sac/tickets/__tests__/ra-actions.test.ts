import { describe, it, expect } from "vitest";

/**
 * Unit tests for RA reputation code null-safety logic
 * Tests the core transformation: String(r.reputation?.code ?? "SEM_INDICE")
 */
describe("RA Actions - reputationCode transformation", () => {
  it("handles null reputation.code correctly", () => {
    const reputation = { code: null };
    const result = String(reputation.code ?? "SEM_INDICE");
    expect(result).toBe("SEM_INDICE");
  });

  it("handles undefined reputation.code correctly", () => {
    const reputation = { code: undefined };
    const result = String(reputation.code ?? "SEM_INDICE");
    expect(result).toBe("SEM_INDICE");
  });

  it("handles numeric reputation.code correctly", () => {
    const reputation = { code: 123 };
    const result = String(reputation.code ?? "SEM_INDICE");
    expect(result).toBe("123");
  });

  it("handles string reputation.code correctly", () => {
    const reputation = { code: "A" };
    const result = String(reputation.code ?? "SEM_INDICE");
    expect(result).toBe("A");
  });
});