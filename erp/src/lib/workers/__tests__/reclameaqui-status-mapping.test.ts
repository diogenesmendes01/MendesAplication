import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mockWarn is available when the factory runs (vi.mock is hoisted)
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  return {
    logger: _log,
    createChildLogger: vi.fn(() => _log),
    sanitizeParams: vi.fn((obj: Record<string, unknown>) => obj),
    truncateForLog: vi.fn((v: unknown) => v),
    classifyError: vi.fn(() => "INTERNAL_ERROR"),
    classifyErrorByStatus: vi.fn(() => "INTERNAL_ERROR"),
    ErrorCode: {
      AUTH_FAILED: "AUTH_FAILED",
      VALIDATION_ERROR: "VALIDATION_ERROR",
      NOT_FOUND: "NOT_FOUND",
      PERMISSION_DENIED: "PERMISSION_DENIED",
      EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
      DATABASE_ERROR: "DATABASE_ERROR",
      ENCRYPTION_ERROR: "ENCRYPTION_ERROR",
      RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
      INTERNAL_ERROR: "INTERNAL_ERROR",
      AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
    },
    MAX_LOG_ARG_SIZE: 10240,
  };
});

import { mapRaStatusToTicketStatus } from "../reclameaqui-inbound";

describe("mapRaStatusToTicketStatus", () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it("maps status 5 (Não respondido) → OPEN", () => {
    expect(mapRaStatusToTicketStatus(5)).toBe("OPEN");
  });

  it("maps status 6 (Respondido) → WAITING_CLIENT", () => {
    expect(mapRaStatusToTicketStatus(6)).toBe("WAITING_CLIENT");
  });

  it.each([
    [7, "Réplica consumidor"],
    [8, "Réplica empresa"],
    [11, "Moderação"],
    [20, "Réplica pendente"],
  ])("maps status %i (%s) → IN_PROGRESS", (id: number) => {
    expect(mapRaStatusToTicketStatus(id)).toBe("IN_PROGRESS");
  });

  it.each([
    [9, "Avaliado"],
    [18, "Avaliado Resolvido"],
    [19, "Avaliado Não Resolvido"],
  ])("maps status %i (%s) → RESOLVED", (id: number) => {
    expect(mapRaStatusToTicketStatus(id)).toBe("RESOLVED");
  });

  it.each([
    [10, "Congelado"],
    [12, "Desativado consumidor"],
    [13, "Inativa no RA"],
    [17, "Redistribuição"],
  ])("maps status %i (%s) → CLOSED", (id: number) => {
    expect(mapRaStatusToTicketStatus(id)).toBe("CLOSED");
  });

  it("defaults unknown status to OPEN and logs warning", () => {
    expect(mapRaStatusToTicketStatus(999)).toBe("OPEN");
    expect(mockWarn).toHaveBeenCalledWith(
      { raStatusId: 999 },
      "[reclameaqui] Unknown RA status ID, defaulting to OPEN"
    );
  });

  it("covers all 13 documented RA status IDs without warnings", () => {
    const documentedIds = [5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20];
    for (const id of documentedIds) {
      const result = mapRaStatusToTicketStatus(id);
      expect(["OPEN", "WAITING_CLIENT", "IN_PROGRESS", "RESOLVED", "CLOSED"]).toContain(result);
    }
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
