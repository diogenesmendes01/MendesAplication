/**
 * Tests for v2 tool dry-run paths: LOOKUP_CLIENT_BY_CNPJ, LINK_TICKET_TO_CLIENT, READ_ATTACHMENT.
 * Validates input checks, CNPJ validation, and dry-run simulation strings.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findUnique: vi.fn(), update: vi.fn() },
    ticketMessage: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    client: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    additionalContact: { create: vi.fn() },
    attachmentExtraction: { findUnique: vi.fn() },
    aiDocument: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/whatsapp-api", () => ({
  sendTextMessage: vi.fn(),
}));

vi.mock("@/lib/queue", () => ({
  emailOutboundQueue: { add: vi.fn() },
}));

vi.mock("@/lib/ai/embeddings", () => ({
  searchDocuments: vi.fn().mockResolvedValue([]),
  searchDocumentsByChannel: vi.fn().mockResolvedValue([]),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDryRunContext(overrides = {}) {
  return {
    ticketId: "simulation",
    companyId: "company-1",
    clientId: "simulation",
    contactPhone: "5511999999999",
    channel: "WHATSAPP" as const,
    dryRun: true,
    ...overrides,
  };
}

// Known valid CNPJ: 11.222.333/0001-81
const VALID_CNPJ = "11222333000181";
// Invalid check digits
const INVALID_CNPJ = "11222333000100";

// ─── LOOKUP_CLIENT_BY_CNPJ dry-run ──────────────────────────────────────────

describe("executeTool — LOOKUP_CLIENT_BY_CNPJ dry-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns simulation result for valid CNPJ", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "LOOKUP_CLIENT_BY_CNPJ",
      { cnpj: VALID_CNPJ },
      makeDryRunContext()
    );

    expect(result).toContain("[SIMULAÇÃO]");
    expect(result).toContain(VALID_CNPJ);
    expect(result).toContain("Cliente encontrado");
  });

  it("returns error when cnpj is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "LOOKUP_CLIENT_BY_CNPJ",
      {},
      makeDryRunContext()
    );

    expect(result).toMatch(/erro/i);
  });

  it("returns error for wrong-length CNPJ", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "LOOKUP_CLIENT_BY_CNPJ",
      { cnpj: "12345" },
      makeDryRunContext()
    );

    expect(result).toMatch(/14 digitos/i);
  });

  it("returns error for invalid check digits", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "LOOKUP_CLIENT_BY_CNPJ",
      { cnpj: INVALID_CNPJ },
      makeDryRunContext()
    );

    expect(result).toMatch(/invalido/i);
  });

  it("accepts 11-digit CPF without CNPJ validation", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "LOOKUP_CLIENT_BY_CNPJ",
      { cnpj: "12345678901" },
      makeDryRunContext()
    );

    expect(result).toContain("[SIMULAÇÃO]");
    expect(result).toContain("CPF");
  });

  it("does NOT call prisma in dry-run", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { executeTool } = await import("@/lib/ai/tool-executor");

    await executeTool(
      "LOOKUP_CLIENT_BY_CNPJ",
      { cnpj: VALID_CNPJ },
      makeDryRunContext()
    );

    expect(prisma.client.findFirst).not.toHaveBeenCalled();
  });
});

// ─── LINK_TICKET_TO_CLIENT dry-run ──────────────────────────────────────────

describe("executeTool — LINK_TICKET_TO_CLIENT dry-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns simulation result for valid CNPJ", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "LINK_TICKET_TO_CLIENT",
      { cnpj: VALID_CNPJ },
      makeDryRunContext()
    );

    expect(result).toContain("[SIMULAÇÃO]");
    expect(result).toContain("CNPJ");
  });

  it("returns error for invalid CNPJ", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "LINK_TICKET_TO_CLIENT",
      { cnpj: INVALID_CNPJ },
      makeDryRunContext()
    );

    expect(result).toMatch(/invalido/i);
  });

  it("returns error for wrong-length value", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "LINK_TICKET_TO_CLIENT",
      { cnpj: "abc" },
      makeDryRunContext()
    );

    expect(result).toMatch(/erro/i);
  });

  it("does NOT call prisma in dry-run", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { executeTool } = await import("@/lib/ai/tool-executor");

    await executeTool(
      "LINK_TICKET_TO_CLIENT",
      { cnpj: VALID_CNPJ, contactName: "João" },
      makeDryRunContext()
    );

    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(prisma.client.create).not.toHaveBeenCalled();
  });
});

// ─── READ_ATTACHMENT dry-run ────────────────────────────────────────────────

describe("executeTool — READ_ATTACHMENT dry-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns simulation result for valid attachmentId", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "READ_ATTACHMENT",
      { attachmentId: "att_123" },
      makeDryRunContext()
    );

    expect(result).toContain("[SIMULAÇÃO]");
    expect(result).toContain("att_123");
  });

  it("returns simulation result with query", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "READ_ATTACHMENT",
      { attachmentId: "att_123", query: "valor do boleto" },
      makeDryRunContext()
    );

    expect(result).toContain("[SIMULAÇÃO]");
    expect(result).toContain("valor do boleto");
  });

  it("returns error when attachmentId is missing", async () => {
    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool(
      "READ_ATTACHMENT",
      {},
      makeDryRunContext()
    );

    expect(result).toMatch(/erro/i);
  });

  it("does NOT call prisma in dry-run", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { executeTool } = await import("@/lib/ai/tool-executor");

    await executeTool(
      "READ_ATTACHMENT",
      { attachmentId: "att_123" },
      makeDryRunContext()
    );

    expect(prisma.attachmentExtraction.findUnique).not.toHaveBeenCalled();
  });
});
