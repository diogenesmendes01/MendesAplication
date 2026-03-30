/**
 * Unit tests for tool-executor.ts suggestion mode behavior.
 * Verifies that write tools are intercepted and read tools execute normally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSearchDocuments = vi.fn().mockResolvedValue([]);
const mockSearchDocumentsByChannel = vi.fn().mockResolvedValue([]);
const mockSendTextMessage = vi.fn();
const mockEmailOutboundQueueAdd = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    client: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
    ticket: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    ticketMessage: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    additionalContact: { create: vi.fn() },
    attachmentExtraction: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("@/lib/ai/embeddings", () => ({
  searchDocuments: (...a: unknown[]) => mockSearchDocuments(...a),
  searchDocumentsByChannel: (...a: unknown[]) => mockSearchDocumentsByChannel(...a),
}));

vi.mock("@/lib/whatsapp-api", () => ({
  sendTextMessage: (...a: unknown[]) => mockSendTextMessage(...a),
}));

vi.mock("@/lib/queue", () => ({
  emailOutboundQueue: { add: (...a: unknown[]) => mockEmailOutboundQueueAdd(...a) },
}));

vi.mock("@/lib/ai/sanitize-utils", () => ({
  sanitizeEmailHtml: (html: string) => html,
}));

vi.mock("@/lib/ai/cnpj-utils", () => ({
  isValidCnpj: (cnpj: string) => cnpj.length === 14,
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { executeTool, isReadOnlyTool, READ_ONLY_TOOLS, WRITE_TOOLS } from "../tool-executor";
import type { ToolContext } from "../tool-executor";

const baseSuggestionContext: ToolContext = {
  ticketId: "ticket-1",
  companyId: "company-1",
  clientId: "client-1",
  contactPhone: "5511999999999",
  channel: "WHATSAPP",
  dryRun: false,
  suggestionMode: true,
};

const baseNormalContext: ToolContext = {
  ...baseSuggestionContext,
  suggestionMode: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Tool classification", () => {
  it("classifies SEARCH_DOCUMENTS as read-only", () => {
    expect(isReadOnlyTool("SEARCH_DOCUMENTS")).toBe(true);
  });

  it("classifies GET_CLIENT_INFO as read-only", () => {
    expect(isReadOnlyTool("GET_CLIENT_INFO")).toBe(true);
  });

  it("classifies GET_HISTORY as read-only", () => {
    expect(isReadOnlyTool("GET_HISTORY")).toBe(true);
  });

  it("classifies LOOKUP_CLIENT_BY_CNPJ as read-only", () => {
    expect(isReadOnlyTool("LOOKUP_CLIENT_BY_CNPJ")).toBe(true);
  });

  it("classifies READ_ATTACHMENT as read-only", () => {
    expect(isReadOnlyTool("READ_ATTACHMENT")).toBe(true);
  });

  it("classifies RESPOND as write", () => {
    expect(isReadOnlyTool("RESPOND")).toBe(false);
    expect(WRITE_TOOLS.has("RESPOND")).toBe(true);
  });

  it("classifies RESPOND_EMAIL as write", () => {
    expect(isReadOnlyTool("RESPOND_EMAIL")).toBe(false);
    expect(WRITE_TOOLS.has("RESPOND_EMAIL")).toBe(true);
  });

  it("classifies ESCALATE as write", () => {
    expect(isReadOnlyTool("ESCALATE")).toBe(false);
    expect(WRITE_TOOLS.has("ESCALATE")).toBe(true);
  });

  it("has no overlap between read-only and write sets", () => {
    for (const tool of Array.from(READ_ONLY_TOOLS)) {
      expect(WRITE_TOOLS.has(tool)).toBe(false);
    }
  });
});

describe("Suggestion mode interception", () => {
  it("intercepts RESPOND in suggestion mode", async () => {
    const result = await executeTool(
      "RESPOND",
      { message: "Olá cliente" },
      baseSuggestionContext
    );

    expect(result).toContain("Sugestão registrada");
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("intercepts RESPOND_EMAIL in suggestion mode", async () => {
    const result = await executeTool(
      "RESPOND_EMAIL",
      { subject: "Re: Test", message: "Email body" },
      baseSuggestionContext
    );

    expect(result).toContain("Sugestão registrada");
    expect(mockEmailOutboundQueueAdd).not.toHaveBeenCalled();
  });

  it("intercepts ESCALATE in suggestion mode", async () => {
    const result = await executeTool(
      "ESCALATE",
      { reason: "Complexo demais" },
      baseSuggestionContext
    );

    expect(result).toContain("Sugestão registrada");
    expect(result).toContain("Complexo demais");
  });

  it("intercepts RESPOND_RECLAMEAQUI in suggestion mode", async () => {
    const result = await executeTool(
      "RESPOND_RECLAMEAQUI",
      {
        privateMessage: "Mensagem privada",
        publicMessage: "Mensagem pública",
        detectedType: "outro",
        confidence: 0.8,
      },
      { ...baseSuggestionContext, channel: "RECLAMEAQUI" }
    );

    const parsed = JSON.parse(result);
    expect(parsed.privateMessage).toBe("Mensagem privada");
    expect(parsed.publicMessage).toBe("Mensagem pública");
  });

  it("allows SEARCH_DOCUMENTS in suggestion mode (read-only)", async () => {
    mockSearchDocuments.mockResolvedValue([]);

    const result = await executeTool(
      "SEARCH_DOCUMENTS",
      { query: "boleto" },
      baseSuggestionContext
    );

    // Read-only tools execute normally
    expect(mockSearchDocuments).toHaveBeenCalled();
    expect(result).toBe("Nenhum documento relevante encontrado na base de conhecimento.");
  });

  it("allows GET_HISTORY in suggestion mode (read-only)", async () => {
    const result = await executeTool(
      "GET_HISTORY",
      { limit: 10 },
      baseSuggestionContext
    );

    // Read-only tools execute normally — returns empty history
    expect(result).toContain("Nenhum historico de mensagens encontrado.");
  });
});

describe("Normal mode (no interception)", () => {
  it("SEARCH_DOCUMENTS works the same in normal mode", async () => {
    mockSearchDocuments.mockResolvedValue([]);

    const result = await executeTool(
      "SEARCH_DOCUMENTS",
      { query: "test" },
      baseNormalContext
    );

    expect(mockSearchDocuments).toHaveBeenCalled();
    expect(result).toContain("Nenhum documento relevante");
  });
});
