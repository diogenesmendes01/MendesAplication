import { describe, it, expect } from "vitest";
import { RA_STATUS } from "@/lib/reclameaqui/types";

/**
 * Unit tests for RA dashboard KPI query semantics.
 * Validates that the constants used in dashboard-actions.ts match
 * the expected Reclame Aqui status IDs from the HugMe API.
 */
describe("RA Dashboard KPI Constants", () => {
  it("RESPONDIDO status ID should be 6 (Respondido / Aguardando consumidor)", () => {
    expect(RA_STATUS.RESPONDIDO).toBe(6);
  });

  it("MODERACAO status ID should be 11 (Moderação pendente)", () => {
    expect(RA_STATUS.MODERACAO).toBe(11);
  });

  it("NAO_RESPONDIDO status ID should be 5", () => {
    expect(RA_STATUS.NAO_RESPONDIDO).toBe(5);
  });

  it("all RA_STATUS values should be unique numbers", () => {
    const values = Object.values(RA_STATUS);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe("number");
    }
  });

  it("RA_STATUS should contain all documented status IDs", () => {
    // All 13 documented RA status IDs per HugMe API
    const expectedIds = [5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20];
    const actualIds = Object.values(RA_STATUS);
    for (const id of expectedIds) {
      expect(actualIds).toContain(id);
    }
  });
});
