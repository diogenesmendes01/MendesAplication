/**
 * Unit tests for suggestion-mode.ts
 * Tests the suggestion mode business logic:
 * - Confidence calculation
 * - Operation mode resolution
 * - Hybrid auto-execute decision
 * - AiSuggestion creation
 * - Approve / Reject flows
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrismaAiSuggestionCreate = vi.fn();
const mockPrismaAiSuggestionFindUnique = vi.fn();
const mockPrismaAiSuggestionUpdate = vi.fn();
const mockPrismaTicketMessageUpdate = vi.fn();
const mockExecuteTool = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiSuggestion: {
      create: (...a: unknown[]) => mockPrismaAiSuggestionCreate(...a),
      findUnique: (...a: unknown[]) => mockPrismaAiSuggestionFindUnique(...a),
      update: (...a: unknown[]) => mockPrismaAiSuggestionUpdate(...a),
    },
    ticketMessage: {
      update: (...a: unknown[]) => mockPrismaTicketMessageUpdate(...a),
    },
  },
}));

vi.mock("@/lib/ai/tool-executor", () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
  isReadOnlyTool: (name: string) =>
    ["SEARCH_DOCUMENTS", "GET_CLIENT_INFO", "GET_HISTORY", "LOOKUP_CLIENT_BY_CNPJ", "READ_ATTACHMENT"].includes(name),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
  calculateConfidence,
  shouldRunAsSuggestion,
  shouldAutoExecuteHybrid,
  createAiSuggestion,
  approveSuggestion,
  rejectSuggestion,
} from "../suggestion-mode";
import type { CapturedAction } from "../agent";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calculateConfidence", () => {
  it("returns base confidence with no inputs", () => {
    const result = calculateConfidence({});
    expect(result).toBe(0.2);
  });

  it("accumulates confidence from positive signals", () => {
    const result = calculateConfidence({
      searchResultsFound: true,
      highSimilarityMatch: true,
      clientIdentified: true,
      historyAvailable: true,
      toolsExecuted: ["GET_CLIENT_INFO"],
    });
    // 0.2 + 0.2 + 0.15 + 0.1 + 0.1 + 0.05 = 0.8
    expect(result).toBe(0.8);
  });

  it("averages with LLM confidence", () => {
    const result = calculateConfidence({
      llmConfidence: 0.9,
    });
    // (0.2 + 0.9) / 2 = 0.55
    expect(result).toBe(0.55);
  });

  it("caps at 1.0", () => {
    const result = calculateConfidence({
      searchResultsFound: true,
      highSimilarityMatch: true,
      clientIdentified: true,
      historyAvailable: true,
      toolsExecuted: ["GET_CLIENT_INFO"],
      llmConfidence: 1.0,
    });
    expect(result).toBeLessThanOrEqual(1.0);
  });
});

describe("shouldRunAsSuggestion", () => {
  it("returns false for auto mode", () => {
    expect(shouldRunAsSuggestion("auto")).toBe(false);
  });

  it("returns true for suggest mode", () => {
    expect(shouldRunAsSuggestion("suggest")).toBe(true);
  });

  it("returns true for hybrid mode", () => {
    expect(shouldRunAsSuggestion("hybrid")).toBe(true);
  });
});

describe("shouldAutoExecuteHybrid", () => {
  it("auto-executes when confidence >= threshold", () => {
    expect(
      shouldAutoExecuteHybrid(0.85, 0.8, [{ toolName: "RESPOND", args: {}, order: 0 }], [])
    ).toBe(true);
  });

  it("does not auto-execute when confidence < threshold", () => {
    expect(
      shouldAutoExecuteHybrid(0.5, 0.8, [{ toolName: "RESPOND", args: {}, order: 0 }], [])
    ).toBe(false);
  });

  it("does not auto-execute when action requires approval", () => {
    expect(
      shouldAutoExecuteHybrid(0.95, 0.8, [{ toolName: "ESCALATE", args: {}, order: 0 }], ["ESCALATE"])
    ).toBe(false);
  });

  it("auto-executes when no actions match alwaysRequireApproval", () => {
    expect(
      shouldAutoExecuteHybrid(0.9, 0.8, [{ toolName: "RESPOND", args: {}, order: 0 }], ["ESCALATE"])
    ).toBe(true);
  });
});

describe("createAiSuggestion", () => {
  it("creates a suggestion record in the database", async () => {
    mockPrismaAiSuggestionCreate.mockResolvedValue({ id: "sug-123" });

    const id = await createAiSuggestion({
      ticketId: "ticket-1",
      companyId: "company-1",
      channel: "WHATSAPP",
      messageId: "msg-1",
      analysis: { intent: "test" },
      suggestedResponse: "Hello!",
      suggestedActions: [{ toolName: "RESPOND", args: { message: "Hello!" }, order: 0 }],
      confidence: 0.7,
    });

    expect(id).toBe("sug-123");
    expect(mockPrismaAiSuggestionCreate).toHaveBeenCalledOnce();
    const call = mockPrismaAiSuggestionCreate.mock.calls[0][0];
    expect(call.data.ticketId).toBe("ticket-1");
    expect(call.data.channel).toBe("WHATSAPP");
    expect(call.data.status).toBe("PENDING");
    expect(call.data.confidence).toBe(0.7);
  });

  it("updates trigger message status to PENDING_APPROVAL", async () => {
    mockPrismaAiSuggestionCreate.mockResolvedValue({ id: "sug-456" });

    await createAiSuggestion({
      ticketId: "ticket-1",
      companyId: "company-1",
      channel: "EMAIL",
      messageId: "msg-99",
      analysis: {},
      suggestedResponse: "Reply",
      suggestedActions: [],
      confidence: 0.5,
    });

    expect(mockPrismaTicketMessageUpdate).toHaveBeenCalledWith({
      where: { id: "msg-99" },
      data: { deliveryStatus: "PENDING_APPROVAL" },
    });
  });

  it("does not update TicketMessage if no messageId", async () => {
    mockPrismaAiSuggestionCreate.mockResolvedValue({ id: "sug-789" });

    await createAiSuggestion({
      ticketId: "ticket-1",
      companyId: "company-1",
      channel: "WHATSAPP",
      analysis: {},
      suggestedResponse: "Reply",
      suggestedActions: [],
      confidence: 0.5,
    });

    expect(mockPrismaTicketMessageUpdate).not.toHaveBeenCalled();
  });
});

describe("approveSuggestion", () => {
  it("rejects if suggestion not found", async () => {
    mockPrismaAiSuggestionFindUnique.mockResolvedValue(null);

    const result = await approveSuggestion("sug-missing", "user-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("rejects if suggestion already processed", async () => {
    mockPrismaAiSuggestionFindUnique.mockResolvedValue({
      id: "sug-1",
      status: "APPROVED",
    });

    const result = await approveSuggestion("sug-1", "user-1");
    expect(result.success).toBe(false);
  });

  it("executes captured actions and marks as APPROVED", async () => {
    mockPrismaAiSuggestionFindUnique.mockResolvedValue({
      id: "sug-1",
      status: "PENDING",
      ticketId: "ticket-1",
      companyId: "company-1",
      channel: "WHATSAPP",
      suggestedResponse: "Hello!",
      suggestedSubject: null,
      suggestedActions: [
        { toolName: "RESPOND", args: { message: "Hello!" }, order: 0 },
      ],
      ticket: {
        id: "ticket-1",
        clientId: "client-1",
        companyId: "company-1",
        contact: { whatsapp: "5511999999999" },
        client: { telefone: null },
      },
    });
    mockExecuteTool.mockResolvedValue("Mensagem enviada ao cliente com sucesso.");
    mockPrismaAiSuggestionUpdate.mockResolvedValue({});

    const result = await approveSuggestion("sug-1", "user-1");
    expect(result.success).toBe(true);
    expect(mockExecuteTool).toHaveBeenCalledOnce();
    expect(mockPrismaAiSuggestionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sug-1" },
        data: expect.objectContaining({
          status: "APPROVED",
          reviewedBy: "user-1",
        }),
      })
    );
  });

  it("marks as EDITED when editedResponse is provided", async () => {
    mockPrismaAiSuggestionFindUnique.mockResolvedValue({
      id: "sug-1",
      status: "PENDING",
      ticketId: "ticket-1",
      companyId: "company-1",
      channel: "WHATSAPP",
      suggestedResponse: "Original",
      suggestedSubject: null,
      suggestedActions: [
        { toolName: "RESPOND", args: { message: "Original" }, order: 0 },
      ],
      ticket: {
        id: "ticket-1",
        clientId: "client-1",
        companyId: "company-1",
        contact: null,
        client: { telefone: "5511988888888" },
      },
    });
    mockExecuteTool.mockResolvedValue("Ok");
    mockPrismaAiSuggestionUpdate.mockResolvedValue({});

    const result = await approveSuggestion("sug-1", "user-1", "Edited message");
    expect(result.success).toBe(true);
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "RESPOND",
      expect.objectContaining({ message: "Edited message" }),
      expect.anything()
    );
    expect(mockPrismaAiSuggestionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "EDITED",
          editedResponse: "Edited message",
        }),
      })
    );
  });
});

describe("rejectSuggestion", () => {
  it("rejects if suggestion not found", async () => {
    mockPrismaAiSuggestionFindUnique.mockResolvedValue(null);

    const result = await rejectSuggestion("sug-missing", "user-1");
    expect(result.success).toBe(false);
  });

  it("marks as REJECTED with reason", async () => {
    mockPrismaAiSuggestionFindUnique.mockResolvedValue({
      id: "sug-1",
      status: "PENDING",
    });
    mockPrismaAiSuggestionUpdate.mockResolvedValue({});

    const result = await rejectSuggestion("sug-1", "user-1", "Resposta inadequada");
    expect(result.success).toBe(true);
    expect(mockPrismaAiSuggestionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sug-1" },
        data: expect.objectContaining({
          status: "REJECTED",
          rejectionReason: "Resposta inadequada",
        }),
      })
    );
  });
});
