/**
 * Tests for GET_HISTORY enriched with attachment summaries (v2).
 * Validates the formatting of attachment info in history output,
 * including cases with and without AttachmentExtraction data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findUnique: vi.fn() },
    ticketMessage: { create: vi.fn(), findMany: vi.fn() },
    client: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    aiDocument: { findMany: vi.fn().mockResolvedValue([]) },
    attachmentExtraction: { findUnique: vi.fn() },
    contact: { create: vi.fn() },
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

function makeContext(overrides = {}) {
  return {
    ticketId: "ticket-1",
    companyId: "company-1",
    clientId: "client-1",
    contactPhone: "5511999999999",
    channel: "WHATSAPP" as const,
    dryRun: false,
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    direction: "INBOUND",
    content: "Mensagem de teste",
    isAiGenerated: false,
    isInternal: false,
    createdAt: new Date("2026-03-27T10:00:00Z"),
    attachments: [],
    ...overrides,
  };
}

function makeAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    fileName: "nota-fiscal.pdf",
    fileSize: 102400,
    mimeType: "application/pdf",
    extraction: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeTool — GET_HISTORY enriched attachment summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats attachment with completed extraction (summary + metadata)", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.ticketMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMessage({
        attachments: [
          makeAttachment({
            extraction: {
              status: "completed",
              summary: "Nota fiscal de servicos no valor de R$1.500,00",
              metadata: {
                cnpjs: ["12.345.678/0001-90"],
                values: ["R$1.500,00"],
                dates: ["2026-03-15"],
              },
              tokenCount: 350,
            },
          }),
        ],
      }),
    ]);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("GET_HISTORY", {}, makeContext());

    expect(result).toContain("[Cliente]:");
    expect(result).toContain("📎 nota-fiscal.pdf");
    expect(result).toContain("100KB");
    expect(result).toContain("[id:att-1]");
    expect(result).toContain("Nota fiscal de servicos no valor de R$1.500,00");
    expect(result).toContain("CNPJ: 12.345.678/0001-90");
    expect(result).toContain("Valor: R$1.500,00");
    expect(result).toContain("Data: 2026-03-15");
  });

  it("formats attachment with completed extraction but no metadata", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.ticketMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMessage({
        attachments: [
          makeAttachment({
            extraction: {
              status: "completed",
              summary: "Documento genérico",
              metadata: {},
              tokenCount: 120,
            },
          }),
        ],
      }),
    ]);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("GET_HISTORY", {}, makeContext());

    expect(result).toContain("📎 nota-fiscal.pdf");
    expect(result).toContain("Documento genérico");
    // Should NOT contain metadata separators when no metadata
    expect(result).not.toContain("CNPJ:");
    expect(result).not.toContain("Valor:");
  });

  it("formats attachment with processing status", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.ticketMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMessage({
        attachments: [
          makeAttachment({
            extraction: {
              status: "processing",
              summary: null,
              metadata: null,
              tokenCount: 0,
            },
          }),
        ],
      }),
    ]);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("GET_HISTORY", {}, makeContext());

    expect(result).toContain("📎 nota-fiscal.pdf");
    expect(result).toContain("[processando...]");
  });

  it("formats attachment with failed extraction", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.ticketMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMessage({
        attachments: [
          makeAttachment({
            extraction: {
              status: "failed",
              summary: null,
              metadata: null,
              tokenCount: 0,
            },
          }),
        ],
      }),
    ]);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("GET_HISTORY", {}, makeContext());

    expect(result).toContain("📎 nota-fiscal.pdf");
    expect(result).toContain("[extracao falhou");
  });

  it("formats attachment without any extraction (null)", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.ticketMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMessage({
        attachments: [
          makeAttachment({ extraction: null }),
        ],
      }),
    ]);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("GET_HISTORY", {}, makeContext());

    expect(result).toContain("📎 nota-fiscal.pdf");
    expect(result).toContain("[aguardando processamento]");
  });

  it("formats message with multiple attachments", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.ticketMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMessage({
        attachments: [
          makeAttachment({
            id: "att-1",
            fileName: "boleto.pdf",
            fileSize: 51200,
            extraction: {
              status: "completed",
              summary: "Boleto bancario",
              metadata: { values: ["R$500,00"] },
              tokenCount: 80,
            },
          }),
          makeAttachment({
            id: "att-2",
            fileName: "foto.jpg",
            fileSize: 204800,
            mimeType: "image/jpeg",
            extraction: null,
          }),
        ],
      }),
    ]);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("GET_HISTORY", {}, makeContext());

    expect(result).toContain("📎 boleto.pdf");
    expect(result).toContain("[id:att-1]");
    expect(result).toContain("Boleto bancario");
    expect(result).toContain("📎 foto.jpg");
    expect(result).toContain("[id:att-2]");
    expect(result).toContain("[aguardando processamento]");
  });

  it("formats message without attachments normally", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.ticketMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMessage({ content: "Boa tarde, preciso de ajuda" }),
    ]);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("GET_HISTORY", {}, makeContext());

    expect(result).toContain("[Cliente]: Boa tarde, preciso de ajuda");
    expect(result).not.toContain("📎");
  });

  it("shows extraction summary as 'Sem resumo' when summary is null but status is completed", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.ticketMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMessage({
        attachments: [
          makeAttachment({
            extraction: {
              status: "completed",
              summary: null,
              metadata: null,
              tokenCount: 50,
            },
          }),
        ],
      }),
    ]);

    const { executeTool } = await import("@/lib/ai/tool-executor");
    const result = await executeTool("GET_HISTORY", {}, makeContext());

    expect(result).toContain("Sem resumo");
  });
});
