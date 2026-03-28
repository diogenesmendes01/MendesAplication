import { mapRaStatusToTicketStatus } from "../reclameaqui-inbound";

// Mock logger to capture warnings
const mockWarn = jest.fn();
jest.mock("@/lib/logger", () => ({
  logger: { warn: (...args) => mockWarn(...args) },
}));

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
  ])("maps status %i (%s) → IN_PROGRESS", (id) => {
    expect(mapRaStatusToTicketStatus(id)).toBe("IN_PROGRESS");
  });

  it.each([
    [9, "Avaliado"],
    [18, "Avaliado Resolvido"],
    [19, "Avaliado Não Resolvido"],
  ])("maps status %i (%s) → RESOLVED", (id) => {
    expect(mapRaStatusToTicketStatus(id)).toBe("RESOLVED");
  });

  it.each([
    [10, "Congelado"],
    [12, "Desativado consumidor"],
    [13, "Inativa no RA"],
    [17, "Redistribuição"],
  ])("maps status %i (%s) → CLOSED", (id) => {
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
    // No warnings should have been logged for documented IDs
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
