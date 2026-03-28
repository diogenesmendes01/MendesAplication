/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-unused-vars */
/**
 * Unit tests for suggestion-mode.ts
 * Tests the suggestion mode business logic:
 * - Confidence calculation
 * - Operation mode resolution
 * - Hybrid auto-execute decision
 * - AiSuggestion creation
 * - Approve / Reject flows
 * - Tenant isolation
 * - Race condition protection
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrismaAiSuggestionCreate = vi.fn();
const mockPrismaAiSuggestionFindUnique = vi.fn();
const mockPrismaAiSuggestionUpdate = vi.fn();
const mockPrismaAiSuggestionUpdateMany = vi.fn();
const mockPrismaTicketMessageUpdate = vi.fn();
const mockPrismaTransaction = vi.fn();
const mockExecuteTool = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiSuggestion: {
      create: (...a: unknown[]) => mockPrismaAiSuggestionCreate(...a),
      findUnique: (...a: unknown[]) => mockPrismaAiSuggestionFindUnique(...a),
      update: (...a: unknown[]) => mockPrismaAiSuggestionUpdate(...a),
      updateMany: (...a: unknown[]) => mockPrismaAiSuggestionUpdateMany(...a),
    },
    ticketMessage: {
      update: (...a: unknown[]) => mockPrismaTicketMessageUpdate(...a),
    },
    $transaction: (...a: unknown[]) => mockPrismaTransaction(...a),
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

describe("calculateConfidence — read-only tools", () => {
  it("returns > 0.2 when read-only search tools executed successfully", () => {
    const result = calculateConfidence({
      searchResultsFound: true,
      toolsExecuted: ["SEARCH_DOCUMENTS"],
    });
    // 0.2 (base) + 0.1 (searchResultsFound) = 0.3
    expect(result).toBeGreaterThan(0.2);
    expect(result).toBe(0.3);
  });

  it("returns > 0.2 when client info tool executed", () => {
    const result = calculateConfidence({
      clientIdentified: true,
      toolsExecuted: ["GET_CLIENT_INFO"],
    });
    // 0.2 (base) + 0.15 (clientIdentified) + 0.05 (GET_CLIENT_INFO in toolsExecuted) = 0.4
    expect(result).toBeGreaterThan(0.2);
    expect(result).toBe(0.4);
  });

  it("returns > 0.2 with multiple read-only tools", () => {
    const result = calculateConfidence({
      searchResultsFound: true,
      clientIdentified: true,
      historyAvailable: true,
      toolsExecuted: ["SEARCH_DOCUMENTS", "GET_CLIENT_INFO", "GET_HISTORY"],
    });
    // 0.2 + 0.1 + 0.15 + 0.1 + 0.05 = 0.6
    expect(result).toBeGreaterThan(0.2);
    expect(result).toBe(0.6);
  });

  it("returns base 0.2 when no tools executed (empty toolsExecuted)", () => {
    const result = calculateConfidence({
      toolsExecuted: [],
    });
    expect(result).toBe(0.2);
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
  const baseSuggestion = {
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
  };

  it("rejects if suggestion not found or already processed (race condition)", async () => {
    // Transaction simulates: updateMany returns 0 rows (already processed)
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });

    const result = await approveSuggestion("sug-missing", "user-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found or already processed");
  });

  it("executes captured actions and marks as APPROVED", async () => {
    // Transaction claims the suggestion
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue(baseSuggestion),
          update: vi.fn(),
        },
      };
      return fn(tx);
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
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            ...baseSuggestion,
            ticket: {
              ...baseSuggestion.ticket,
              contact: null,
              client: { telefone: "5511988888888" },
            },
          }),
          update: vi.fn(),
        },
      };
      return fn(tx);
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

  it("rejects when companyId does not match (tenant isolation)", async () => {
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue(baseSuggestion),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    const result = await approveSuggestion("sug-1", "user-1", undefined, undefined, "other-company");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Access denied");
  });

  it("allows approval when companyId matches", async () => {
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue(baseSuggestion),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });
    mockExecuteTool.mockResolvedValue("Ok");
    mockPrismaAiSuggestionUpdate.mockResolvedValue({});

    const result = await approveSuggestion("sug-1", "user-1", undefined, undefined, "company-1");
    expect(result.success).toBe(true);
  });

  it("prevents double approval via race condition (atomic updateMany)", async () => {
    // Simulate: first call claims (count=1), second call finds count=0
    let callCount = 0;
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      callCount++;
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: callCount === 1 ? 1 : 0 }),
          findUnique: vi.fn().mockResolvedValue(baseSuggestion),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });
    mockExecuteTool.mockResolvedValue("Ok");
    mockPrismaAiSuggestionUpdate.mockResolvedValue({});

    // First approval succeeds
    const result1 = await approveSuggestion("sug-1", "user-1");
    expect(result1.success).toBe(true);

    // Second approval fails (already claimed)
    const result2 = await approveSuggestion("sug-1", "user-2");
    expect(result2.success).toBe(false);
    expect(result2.error).toContain("already processed");
  });
});


describe("approveSuggestion — PROCESSING status (claim flow)", () => {
  const baseSuggestion = {
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
  };

  it("transitions from PENDING to PROCESSING during claim", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          updateMany: updateManyMock,
          findUnique: vi.fn().mockResolvedValue(baseSuggestion),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });
    mockExecuteTool.mockResolvedValue("Ok");
    mockPrismaAiSuggestionUpdate.mockResolvedValue({});

    const result = await approveSuggestion("sug-1", "user-1");
    expect(result.success).toBe(true);

    // Verify the claim step: PENDING → PROCESSING
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "sug-1", status: "PENDING" },
      data: { status: "PROCESSING" },
    });
  });

  it("rejects second claim when first already set PROCESSING", async () => {
    // First call succeeds (count=1), second fails (count=0, already PROCESSING)
    let callCount = 0;
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      callCount++;
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: callCount === 1 ? 1 : 0 }),
          findUnique: vi.fn().mockResolvedValue(baseSuggestion),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });
    mockExecuteTool.mockResolvedValue("Ok");
    mockPrismaAiSuggestionUpdate.mockResolvedValue({});

    const result1 = await approveSuggestion("sug-1", "user-1");
    expect(result1.success).toBe(true);

    // Second user tries to approve — PROCESSING blocks them
    const result2 = await approveSuggestion("sug-1", "user-2");
    expect(result2.success).toBe(false);
    expect(result2.error).toContain("already processed");
  });

  it("rolls back PROCESSING to PENDING on tenant isolation failure", async () => {
    const updateFn = vi.fn().mockResolvedValue({});
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue(baseSuggestion),
          update: updateFn,
        },
      };
      return fn(tx);
    });

    const result = await approveSuggestion("sug-1", "user-1", undefined, undefined, "other-company");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Access denied");

    // Verify rollback: status set back to PENDING
    expect(updateFn).toHaveBeenCalledWith({
      where: { id: "sug-1" },
      data: { status: "PENDING" },
    });
  });
});

describe("rejectSuggestion", () => {
  it("rejects if suggestion not found or already processed", async () => {
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          findUnique: vi.fn().mockResolvedValue(null),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return fn(tx);
    });

    const result = await rejectSuggestion("sug-missing", "user-1");
    expect(result.success).toBe(false);
  });

  it("marks as REJECTED with reason", async () => {
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return fn(tx);
    });

    const result = await rejectSuggestion("sug-1", "user-1", "Resposta inadequada");
    expect(result.success).toBe(true);
  });

  it("rejects when companyId does not match (tenant isolation)", async () => {
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          findUnique: vi.fn().mockResolvedValue({
            id: "sug-1",
            status: "PENDING",
            ticket: { companyId: "company-1" },
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return fn(tx);
    });

    const result = await rejectSuggestion("sug-1", "user-1", "reason", "other-company");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Access denied");
  });

  it("allows rejection when companyId matches", async () => {
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      const tx = {
        aiSuggestion: {
          findUnique: vi.fn().mockResolvedValue({
            id: "sug-1",
            status: "PENDING",
            ticket: { companyId: "company-1" },
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return fn(tx);
    });

    const result = await rejectSuggestion("sug-1", "user-1", "reason", "company-1");
    expect(result.success).toBe(true);
  });

  it("prevents double rejection (race condition)", async () => {
    // First call succeeds, second gets count=0
    let callCount = 0;
    mockPrismaTransaction.mockImplementation(async (fn: Function) => {
      callCount++;
      const tx = {
        aiSuggestion: {
          updateMany: vi.fn().mockResolvedValue({ count: callCount === 1 ? 1 : 0 }),
        },
      };
      return fn(tx);
    });

    const result1 = await rejectSuggestion("sug-1", "user-1", "reason");
    expect(result1.success).toBe(true);

    const result2 = await rejectSuggestion("sug-1", "user-2", "reason");
    expect(result2.success).toBe(false);
  });
});
