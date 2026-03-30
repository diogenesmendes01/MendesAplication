/**
 * Unit tests for ai-agent.ts worker — suggestion mode routing.
 * Verifies that the worker correctly routes based on operationMode
 * and computes confidence via calculateConfidence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunAgent = vi.fn();
const mockResolveAiConfigSelect = vi.fn();
const mockCreateAiSuggestion = vi.fn().mockResolvedValue("sug-123");
const mockShouldRunAsSuggestion = vi.fn();
const mockShouldAutoExecuteHybrid = vi.fn();
const mockApproveSuggestion = vi.fn().mockResolvedValue({ success: true });
const mockCalculateConfidence = vi.fn().mockReturnValue(0.65);

const mockPrismaTicketFindUnique = vi.fn();
const mockPrismaTicketUpdate = vi.fn();
const mockPrismaTicketMessageCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: {
      findUnique: (...a: unknown[]) => mockPrismaTicketFindUnique(...a),
      update: (...a: unknown[]) => mockPrismaTicketUpdate(...a),
    },
    ticketMessage: {
      create: (...a: unknown[]) => mockPrismaTicketMessageCreate(...a),
    },
    aiConfig: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    aiProviderHealth: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/ai/agent", () => ({
  runAgent: (...args: unknown[]) => mockRunAgent(...args),
}));

vi.mock("@/lib/ai/resolve-config", () => ({
  resolveAiConfigSelect: (...args: unknown[]) => mockResolveAiConfigSelect(...args),
  resolveAiConfig: (...args: unknown[]) => mockResolveAiConfigSelect(...args),
}));

vi.mock("@/lib/ai/suggestion-mode", () => ({
  calculateConfidence: (...args: unknown[]) => mockCalculateConfidence(...args),
  createAiSuggestion: (...args: unknown[]) => mockCreateAiSuggestion(...args),
  shouldRunAsSuggestion: (...args: unknown[]) => mockShouldRunAsSuggestion(...args),
  shouldAutoExecuteHybrid: (...args: unknown[]) => mockShouldAutoExecuteHybrid(...args),
  approveSuggestion: (...args: unknown[]) => mockApproveSuggestion(...args),
}));

vi.mock("@/lib/queue", () => ({
  reclameaquiOutboundQueue: { add: vi.fn() },
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

// ─── Import after mocks ──────────────────────────────────────────────────────

import { processAiAgent } from "../ai-agent";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeJob(data: Record<string, unknown>): Job<Record<string, unknown>> {
  return {
    data: {
      ticketId: "ticket-1",
      companyId: "company-1",
      messageContent: "Olá, preciso de ajuda",
      channel: "WHATSAPP",
      ...data,
    },
  } as unknown as Job<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: ticket exists and AI is enabled
  mockPrismaTicketFindUnique.mockResolvedValue({ aiEnabled: true });

  // Default: AI config with auto mode
  mockResolveAiConfigSelect.mockResolvedValue({
    operationMode: "auto",
    hybridThreshold: 0.8,
    alwaysRequireApproval: [],
    raMode: "auto",
    raEscalationKeywords: [],
    raPrivateBeforePublic: true,
    raAutoRequestEvaluation: false,
  });

  // Default: agent responds successfully
  mockRunAgent.mockResolvedValue({
    responded: true,
    escalated: false,
    iterations: 2,
    capturedActions: [],
  });

  // Default: no suggestion mode
  mockShouldRunAsSuggestion.mockReturnValue(false);

  // Default confidence
  mockCalculateConfidence.mockReturnValue(0.65);
});

describe("processAiAgent — suggestion mode routing", () => {
  it("runs in auto mode by default (no suggestion)", async () => {
    await processAiAgent(makeJob({}));

    expect(mockRunAgent).toHaveBeenCalledWith(
      "ticket-1", "company-1", "Olá, preciso de ajuda", "WHATSAPP",
      { suggestionMode: false }
    );
    expect(mockCreateAiSuggestion).not.toHaveBeenCalled();
  });

  it("runs in suggest mode when operationMode=suggest", async () => {
    mockResolveAiConfigSelect.mockResolvedValue({
      operationMode: "suggest",
      hybridThreshold: 0.8,
      alwaysRequireApproval: [],
      raMode: "auto",
      raEscalationKeywords: [],
    });
    mockShouldRunAsSuggestion.mockReturnValue(true);
    mockRunAgent.mockResolvedValue({
      responded: true,
      escalated: false,
      iterations: 2,
      capturedActions: [{ toolName: "RESPOND", args: { message: "Hello" }, order: 0 }],
    });

    await processAiAgent(makeJob({}));

    expect(mockRunAgent).toHaveBeenCalledWith(
      "ticket-1", "company-1", "Olá, preciso de ajuda", "WHATSAPP",
      { suggestionMode: true }
    );
    // Should create suggestion since there are captured actions
    expect(mockCreateAiSuggestion).toHaveBeenCalledOnce();
  });

  it("skips if ticket not found", async () => {
    mockPrismaTicketFindUnique.mockResolvedValue(null);

    await processAiAgent(makeJob({}));

    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it("skips if AI disabled on ticket", async () => {
    mockPrismaTicketFindUnique.mockResolvedValue({ aiEnabled: false });

    await processAiAgent(makeJob({}));

    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it("handles hybrid mode — auto-execute on high confidence", async () => {
    mockResolveAiConfigSelect.mockResolvedValue({
      operationMode: "hybrid",
      hybridThreshold: 0.8,
      alwaysRequireApproval: [],
      raMode: "auto",
      raEscalationKeywords: [],
    });
    mockShouldRunAsSuggestion.mockReturnValue(true);
    mockShouldAutoExecuteHybrid.mockReturnValue(true);
    mockRunAgent.mockResolvedValue({
      responded: true,
      escalated: false,
      iterations: 1,
      capturedActions: [{ toolName: "RESPOND", args: { message: "Hi" }, order: 0 }],
    });

    await processAiAgent(makeJob({}));

    // Should create suggestion then immediately approve (auto-execute)
    expect(mockCreateAiSuggestion).toHaveBeenCalledOnce();
    expect(mockApproveSuggestion).toHaveBeenCalledOnce();
  });

  it("handles hybrid mode — save as suggestion on low confidence", async () => {
    mockResolveAiConfigSelect.mockResolvedValue({
      operationMode: "hybrid",
      hybridThreshold: 0.8,
      alwaysRequireApproval: [],
      raMode: "auto",
      raEscalationKeywords: [],
    });
    mockShouldRunAsSuggestion.mockReturnValue(true);
    mockShouldAutoExecuteHybrid.mockReturnValue(false);
    mockRunAgent.mockResolvedValue({
      responded: true,
      escalated: false,
      iterations: 1,
      capturedActions: [{ toolName: "RESPOND", args: { message: "Hi" }, order: 0 }],
    });

    await processAiAgent(makeJob({}));

    // Should create suggestion but NOT approve
    expect(mockCreateAiSuggestion).toHaveBeenCalledOnce();
    expect(mockApproveSuggestion).not.toHaveBeenCalled();
  });
});

describe("processAiAgent — confidence calculation", () => {
  it("uses calculateConfidence for suggest mode (not hardcoded 0.5)", async () => {
    mockResolveAiConfigSelect.mockResolvedValue({
      operationMode: "suggest",
      hybridThreshold: 0.8,
      alwaysRequireApproval: [],
      raMode: "auto",
      raEscalationKeywords: [],
    });
    mockShouldRunAsSuggestion.mockReturnValue(true);
    mockCalculateConfidence.mockReturnValue(0.45);
    mockRunAgent.mockResolvedValue({
      responded: true,
      escalated: false,
      iterations: 2,
      capturedActions: [
        { toolName: "SEARCH_DOCUMENTS", args: { query: "boleto" }, order: 0 },
        { toolName: "RESPOND", args: { message: "Resposta" }, order: 1 },
      ],
    });

    await processAiAgent(makeJob({}));

    expect(mockCreateAiSuggestion).toHaveBeenCalledOnce();
    // Verify the confidence passed to createAiSuggestion is the calculated value, not 0.5
    const suggestionData = mockCreateAiSuggestion.mock.calls[0][0];
    expect(suggestionData.confidence).toBe(0.45);
  });

  it("uses calculateConfidence for hybrid mode decisions", async () => {
    mockResolveAiConfigSelect.mockResolvedValue({
      operationMode: "hybrid",
      hybridThreshold: 0.8,
      alwaysRequireApproval: [],
      raMode: "auto",
      raEscalationKeywords: [],
    });
    mockShouldRunAsSuggestion.mockReturnValue(true);
    mockShouldAutoExecuteHybrid.mockReturnValue(false);
    mockCalculateConfidence.mockReturnValue(0.35);
    mockRunAgent.mockResolvedValue({
      responded: true,
      escalated: false,
      iterations: 1,
      capturedActions: [{ toolName: "RESPOND", args: { message: "Hi" }, order: 0 }],
    });

    await processAiAgent(makeJob({}));

    // shouldAutoExecuteHybrid should receive the calculated confidence
    expect(mockShouldAutoExecuteHybrid).toHaveBeenCalledWith(
      0.35, 0.8, expect.any(Array), expect.any(Array)
    );
  });
});
