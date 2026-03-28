/**
 * Tests for Reclame Aqui SLA calculation.
 * - calculateRaSlaDeadline: 10 business days from creation
 * - getRaBusinessDaysRemaining: business days between two dates
 */
import { describe, it, expect } from "vitest";
import {
  calculateRaSlaDeadline,
  getRaBusinessDaysRemaining,
} from "../workers/reclameaqui-inbound";

describe("calculateRaSlaDeadline", () => {
  it("should add 10 business days (Mon-Fri) from a Monday", () => {
    // Monday 2026-03-02
    const result = calculateRaSlaDeadline("2026-03-02T10:00:00Z");
    // 10 business days from Mon = 2 weeks later = Mon 2026-03-16
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2); // March
    expect(result.getDate()).toBe(16);
  });

  it("should skip weekends", () => {
    // Wednesday 2026-03-04
    const result = calculateRaSlaDeadline("2026-03-04T10:00:00Z");
    // 5 days to Mon (3/9) is wrong — let's count:
    // Thu 5, Fri 6 (2), skip Sat/Sun, Mon 9 (3), Tue 10 (4), Wed 11 (5),
    // Thu 12 (6), Fri 13 (7), skip Sat/Sun, Mon 16 (8), Tue 17 (9), Wed 18 (10)
    expect(result.getDate()).toBe(18);
    expect(result.getMonth()).toBe(2); // March
  });

  it("should handle creation on a Friday", () => {
    // Friday 2026-03-06
    const result = calculateRaSlaDeadline("2026-03-06T10:00:00Z");
    // Mon 9 (1), Tue 10 (2), Wed 11 (3), Thu 12 (4), Fri 13 (5)
    // Mon 16 (6), Tue 17 (7), Wed 18 (8), Thu 19 (9), Fri 20 (10)
    expect(result.getDate()).toBe(20);
    expect(result.getMonth()).toBe(2);
  });

  it("should handle creation on a Saturday", () => {
    // Saturday 2026-03-07
    const result = calculateRaSlaDeadline("2026-03-07T10:00:00Z");
    // Sun 8 skip, Mon 9 (1), Tue 10 (2), ... Fri 20 (10) - wait
    // Mon 9 (1), Tue 10 (2), Wed 11 (3), Thu 12 (4), Fri 13 (5)
    // Mon 16 (6), Tue 17 (7), Wed 18 (8), Thu 19 (9), Fri 20 (10)
    expect(result.getDate()).toBe(20);
    expect(result.getMonth()).toBe(2);
  });

  it("should handle creation on a Sunday", () => {
    // Sunday 2026-03-08
    const result = calculateRaSlaDeadline("2026-03-08T10:00:00Z");
    // Mon 9 (1), ..., Fri 20 (10)
    expect(result.getDate()).toBe(20);
    expect(result.getMonth()).toBe(2);
  });

  it("should accept Date objects", () => {
    const date = new Date("2026-03-02T10:00:00Z");
    const result = calculateRaSlaDeadline(date);
    expect(result.getDate()).toBe(16);
  });

  it("should handle month boundary crossing", () => {
    // Thursday 2026-03-26
    const result = calculateRaSlaDeadline("2026-03-26T10:00:00Z");
    // Fri 27 (1), Mon 30 (2), Tue 31 (3), Wed Apr 1 (4), Thu 2 (5),
    // Fri 3 (6), Mon 6 (7), Tue 7 (8), Wed 8 (9), Thu 9 (10)
    expect(result.getMonth()).toBe(3); // April
    expect(result.getDate()).toBe(9);
  });
});

describe("getRaBusinessDaysRemaining", () => {
  it("should return positive days when deadline is in the future", () => {
    const deadline = new Date("2026-03-20T10:00:00Z");
    const from = new Date("2026-03-16T10:00:00Z"); // Monday
    // Tue 17 (1), Wed 18 (2), Thu 19 (3), Fri 20 (4)
    const result = getRaBusinessDaysRemaining(deadline, from);
    expect(result).toBe(4);
  });

  it("should return 0 when deadline is today", () => {
    const deadline = new Date("2026-03-16T10:00:00Z");
    const from = new Date("2026-03-16T08:00:00Z");
    const result = getRaBusinessDaysRemaining(deadline, from);
    expect(result).toBe(0);
  });

  it("should return negative days when deadline has passed", () => {
    const deadline = new Date("2026-03-16T10:00:00Z"); // Monday
    const from = new Date("2026-03-18T10:00:00Z"); // Wednesday
    // Counts: Tue 17 (-1), Wed 18 (-2)
    const result = getRaBusinessDaysRemaining(deadline, from);
    expect(result).toBe(-2);
  });

  it("should skip weekends in remaining count", () => {
    const deadline = new Date("2026-03-23T10:00:00Z"); // Monday
    const from = new Date("2026-03-19T10:00:00Z"); // Thursday
    // Fri 20 (1), skip Sat/Sun, Mon 23 (2)
    const result = getRaBusinessDaysRemaining(deadline, from);
    expect(result).toBe(2);
  });

  it("should handle from on Saturday", () => {
    const deadline = new Date("2026-03-23T10:00:00Z"); // Monday
    const from = new Date("2026-03-21T10:00:00Z"); // Saturday
    // Sun skip, Mon 23 (1)
    const result = getRaBusinessDaysRemaining(deadline, from);
    expect(result).toBe(1);
  });
});
