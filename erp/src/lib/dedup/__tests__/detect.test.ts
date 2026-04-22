import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findUnique: (...a: unknown[]) => mockFindUnique(...a), findMany: (...a: unknown[]) => mockFindMany(...a) },
    ticketLink: { findFirst: (...a: unknown[]) => mockFindFirst(...a), create: (...a: unknown[]) => mockCreate(...a) },
  },
}));
vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
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
vi.mock("@/lib/sse", () => ({ sseBus: { publish: vi.fn() } }));

import { detectDuplicates } from "../detect";

function makeTicket(o: Record<string, unknown> = {}) {
  return { id: "ticket-new", clientId: "c1", companyId: "co1", subject: "Preciso da segunda via do boleto NF 4521",
    client: { id: "c1", cpfCnpj: "12345678000199" }, channel: { id: "ch1", type: "WHATSAPP" },
    messages: [{ content: "boleto NF 4521" }], ...o };
}
function makeCandidate(o: Record<string, unknown> = {}) {
  return { id: "ticket-old", clientId: "c1", companyId: "co1", subject: "Boleto NF 4521 vencido",
    channel: { type: "EMAIL" }, messages: [{ content: "Preciso da segunda via do boleto NF 4521" }], ...o };
}

describe("detectDuplicates", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns empty if ticket not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await detectDuplicates("x")).toEqual([]);
  });
  it("returns empty if client has no CNPJ", async () => {
    mockFindUnique.mockResolvedValue(makeTicket({ client: { id: "c1", cpfCnpj: "DESCONHECIDO" } }));
    expect(await detectDuplicates("ticket-new")).toEqual([]);
  });
  it("returns empty if no channel", async () => {
    mockFindUnique.mockResolvedValue(makeTicket({ channel: null }));
    expect(await detectDuplicates("ticket-new")).toEqual([]);
  });
  it("returns empty if no candidates", async () => {
    mockFindUnique.mockResolvedValue(makeTicket());
    mockFindMany.mockResolvedValue([]);
    expect(await detectDuplicates("ticket-new")).toEqual([]);
  });
  it("creates link when similar", async () => {
    mockFindUnique.mockResolvedValue(makeTicket());
    mockFindMany.mockResolvedValue([makeCandidate()]);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "link-1" });
    const r = await detectDuplicates("ticket-new");
    expect(r.length).toBe(1);
    expect(r[0].ticketAId).toBe("ticket-old");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
  it("skips existing link", async () => {
    mockFindUnique.mockResolvedValue(makeTicket());
    mockFindMany.mockResolvedValue([makeCandidate()]);
    mockFindFirst.mockResolvedValue({ id: "exists" });
    expect(await detectDuplicates("ticket-new")).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });
  it("skips low similarity", async () => {
    mockFindUnique.mockResolvedValue(makeTicket());
    mockFindMany.mockResolvedValue([makeCandidate({ subject: "Cancelar assinatura", messages: [{ content: "Cancelem tudo" }] })]);
    mockFindFirst.mockResolvedValue(null);
    expect(await detectDuplicates("ticket-new")).toEqual([]);
  });
  it("high similarity yields DUPLICATE type", async () => {
    mockFindUnique.mockResolvedValue(makeTicket({ subject: "Boleto NF 4521 segunda via", messages: [{ content: "segunda via boleto NF 4521" }] }));
    mockFindMany.mockResolvedValue([makeCandidate({ subject: "Boleto NF 4521 segunda via urgente", messages: [{ content: "urgente segunda via boleto NF 4521" }] })]);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "link-1" });
    const r = await detectDuplicates("ticket-new");
    expect(r.length).toBe(1);
    expect(["DUPLICATE", "RELATED"]).toContain(r[0].type);
  });
});
