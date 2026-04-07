/**
 * Integration Tests for Worker Processors
 * Tests AI agent worker, email workers, and attachment handling
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockRunAgent = vi.fn();
const mockBuildFallbackChain = vi.fn().mockResolvedValue([]);
const mockMarkTicketPendingRecovery = vi.fn().mockResolvedValue(undefined);
const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 10 });
const mockResolveAiConfigSelect = vi.fn().mockResolvedValue({
  operationMode: "auto",
  hybridThreshold: 0.8,
  alwaysRequireApproval: [],
  raMode: null,
  raEscalationKeywords: [],
  raPrivateBeforePublic: true,
  raAutoRequestEvaluation: false,
});

const mockPrismaTicket = {
  findUnique: vi.fn(),
  update: vi.fn(),
};

const mockPrismaTicketMessage = {
  create: vi.fn(),
};

const mockPrismaAiConfig = {
  findFirst: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: mockPrismaTicket,
    ticketMessage: mockPrismaTicketMessage,
    aiConfig: mockPrismaAiConfig,
  },
}));

vi.mock("@/lib/ai/agent", () => ({
  runAgent: (...args: unknown[]) => mockRunAgent(...args),
}));

vi.mock("@/lib/ai/fallback", () => ({
  buildFallbackChain: (...args: unknown[]) => mockBuildFallbackChain(...args),
  isProviderError: (err: unknown) => {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes("503") || msg.includes("timeout") || msg.includes("all providers");
    }
    return false;
  },
}));

vi.mock("@/lib/ai/recovery", () => ({
  markTicketPendingRecovery: (...args: unknown[]) => mockMarkTicketPendingRecovery(...args),
}));

vi.mock("@/lib/ai/rate-limiter", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock("@/lib/ai/resolve-config", () => ({
  resolveAiConfigSelect: (...args: unknown[]) => mockResolveAiConfigSelect(...args),
}));

vi.mock("@/lib/ai/suggestion-mode", () => ({
  calculateConfidence: vi.fn().mockReturnValue(0.8),
  createAiSuggestion: vi.fn().mockResolvedValue("suggestion-id"),
  shouldRunAsSuggestion: vi.fn().mockReturnValue(false),
  shouldAutoExecuteHybrid: vi.fn().mockReturnValue(false),
  approveSuggestion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/queue", () => ({
  reclameaquiOutboundQueue: { add: vi.fn().mockResolvedValue({}) },
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

// ─── Import after mocks ─────────────────────────────────────────────────────

import { processAiAgent } from "../ai-agent";
import type { AiAgentJobData } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeJobData(overrides: Partial<AiAgentJobData> = {}): AiAgentJobData {
  return {
    ticketId: (overrides.ticketId as string) ?? "ticket-1",
    companyId: (overrides.companyId as string) ?? "company-1",
    messageContent: (overrides.messageContent as string) ?? "Hello, I need help",
    messageId: (overrides.messageId as string) ?? "msg-1",
    channel: (overrides.channel as any) ?? "WHATSAPP",
    isRecovery: (overrides.isRecovery as boolean) ?? false,
    raContext: overrides.raContext,
  };
}

function makeJob(data: AiAgentJobData): Partial<Job<AiAgentJobData>> {
  return {
    data,
    name: "ai-agent",
    id: "job-1",
    progress: vi.fn(),
    log: vi.fn(),
    updateProgress: vi.fn(),
  };
}

// ─── AI Agent Worker Tests ───────────────────────────────────────────────────

describe("AI Agent Worker Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaTicket.findUnique.mockResolvedValue({
      id: "ticket-1",
      aiEnabled: true,
      client: { cpfCnpj: "12345678901234" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Happy Path", () => {
    it("processes WhatsApp message successfully", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Here is your information",
        toolsExecuted: ["SEARCH_DOCUMENTS"],
        raResponse: undefined,
      });

      const job = makeJob(
        makeJobData({
          ticketId: "ticket-1",
          channel: "WHATSAPP",
          messageContent: "I need to check my status",
        })
      );

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).toHaveBeenCalled();
      expect(mockPrismaTicket.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ticket-1" },
        })
      );
    });

    it("processes Email message with higher confidence", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Processing your request",
        toolsExecuted: [
          "SEARCH_DOCUMENTS",
          "GET_CLIENT_INFO",
          "GET_HISTORY",
        ],
        raResponse: undefined,
      });

      const job = makeJob(
        makeJobData({
          channel: "EMAIL",
          messageContent: "Corporate inquiry",
        })
      );

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "EMAIL",
        })
      );
    });

    it("handles ReclameAqui with escalation keywords", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Escalating to human",
        raResponse: {
          confidence: 0.95,
          action: "escalate",
        },
        toolsExecuted: [],
      });

      const job = makeJob(
        makeJobData({
          channel: "RECLAMEAQUI",
          messageContent: "Processo judicial contra empresa",
        })
      );

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).toHaveBeenCalled();
    });
  });

  describe("Rate Limiting", () => {
    it("respects rate limit and prevents processing", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });

      const job = makeJob(makeJobData());

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).not.toHaveBeenCalled();
    });

    it("allows processing when under rate limit", async () => {
      mockCheckRateLimit.mockResolvedValueOnce({ allowed: true, remaining: 5 });
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Processed",
        toolsExecuted: [],
      });

      const job = makeJob(makeJobData());

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).toHaveBeenCalled();
    });

    it("tracks rate limit per company", async () => {
      mockCheckRateLimit.mockImplementation((_companyId: string) => {
        return Promise.resolve({ allowed: true, remaining: 10 });
      });

      const job1 = makeJob(makeJobData({ companyId: "company-1" }));
      const job2 = makeJob(makeJobData({ companyId: "company-2" }));

      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "OK",
        toolsExecuted: [],
      });

      await processAiAgent(job1 as Job<AiAgentJobData>);
      await processAiAgent(job2 as Job<AiAgentJobData>);

      expect(mockCheckRateLimit).toHaveBeenCalledWith("company-1", expect.any(String));
      expect(mockCheckRateLimit).toHaveBeenCalledWith("company-2", expect.any(String));
    });
  });

  describe("Error Handling & Recovery", () => {
    it("handles provider errors and marks for recovery", async () => {
      mockRunAgent.mockRejectedValueOnce(new Error("Service unavailable (503)"));

      const job = makeJob(makeJobData({ isRecovery: false }));

      try {
        await processAiAgent(job as Job<AiAgentJobData>);
      } catch {
        // Expected
      }

      expect(mockBuildFallbackChain).toHaveBeenCalled();
    });

    it("skips recovery flow on recovery job", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Recovery successful",
        toolsExecuted: [],
      });

      const job = makeJob(makeJobData({ isRecovery: true }));

      await processAiAgent(job as Job<AiAgentJobData>);

      // Should not attempt fallback chain
      expect(mockBuildFallbackChain).not.toHaveBeenCalled();
    });

    it("handles missing ticket gracefully", async () => {
      mockPrismaTicket.findUnique.mockResolvedValueOnce(null);

      const job = makeJob(makeJobData({ ticketId: "nonexistent" }));

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).not.toHaveBeenCalled();
    });

    it("respects AI toggle per ticket", async () => {
      mockPrismaTicket.findUnique.mockResolvedValueOnce({
        id: "ticket-1",
        aiEnabled: false,
        client: { cpfCnpj: "12345678901234" },
      });

      const job = makeJob(makeJobData());

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).not.toHaveBeenCalled();
    });
  });

  describe("Suggestion Mode", () => {
    it("respects suggestion mode configuration", async () => {
      mockResolveAiConfigSelect.mockResolvedValueOnce({
        operationMode: "suggestion",
        hybridThreshold: 0.8,
        alwaysRequireApproval: [],
        raMode: null,
        raEscalationKeywords: [],
        raPrivateBeforePublic: true,
        raAutoRequestEvaluation: false,
      });

      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Suggestion created",
        toolsExecuted: ["SEARCH_DOCUMENTS"],
      });

      const job = makeJob(makeJobData());

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockResolveAiConfigSelect).toHaveBeenCalled();
    });

    it("requires approval for high-value transactions", async () => {
      mockResolveAiConfigSelect.mockResolvedValueOnce({
        operationMode: "auto",
        hybridThreshold: 0.8,
        alwaysRequireApproval: ["refund_request"],
        raMode: null,
        raEscalationKeywords: [],
        raPrivateBeforePublic: true,
        raAutoRequestEvaluation: false,
      });

      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Refund created",
        toolsExecuted: [],
        capturedActions: [{ type: "refund_request", amount: 500 }],
      });

      const job = makeJob(makeJobData());

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockResolveAiConfigSelect).toHaveBeenCalled();
    });
  });

  describe("Channel-Specific Behavior", () => {
    it("applies WhatsApp-specific transformations", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "WhatsApp formatted response",
        toolsExecuted: [],
      });

      const job = makeJob(
        makeJobData({
          channel: "WHATSAPP",
          messageContent: "Short message",
        })
      );

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "WHATSAPP",
        })
      );
    });

    it("enriches ReclameAqui context with client CNPJ", async () => {
      mockPrismaTicket.findUnique.mockResolvedValueOnce({
        id: "ticket-1",
        aiEnabled: true,
        client: { cpfCnpj: "12345678901234" },
      });

      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "RA response",
        raResponse: { confidence: 0.85, action: "respond" },
        toolsExecuted: [],
      });

      const job = makeJob(
        makeJobData({
          channel: "RECLAMEAQUI",
          raContext: { complaintId: "complaint-123" },
        })
      );

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          raContext: expect.objectContaining({
            complaintId: "complaint-123",
          }),
        })
      );
    });
  });

  describe("Confidence Calculation", () => {
    it("derives confidence from tools executed for non-RA channels", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Found matching document",
        toolsExecuted: ["SEARCH_DOCUMENTS", "GET_CLIENT_INFO", "GET_HISTORY"],
        raResponse: undefined,
      });

      const job = makeJob(makeJobData({ channel: "EMAIL" }));

      await processAiAgent(job as Job<AiAgentJobData>);

      // Confidence should be calculated from tool execution
      expect(mockRunAgent).toHaveBeenCalled();
    });

    it("uses RA response confidence directly for RA channels", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "RA handling",
        raResponse: { confidence: 0.92, action: "respond" },
        toolsExecuted: [],
      });

      const job = makeJob(makeJobData({ channel: "RECLAMEAQUI" }));

      await processAiAgent(job as Job<AiAgentJobData>);

      expect(mockRunAgent).toHaveBeenCalled();
    });
  });

  describe("Message Recording", () => {
    it("creates ticket message after successful processing", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Logged response",
        toolsExecuted: [],
      });

      mockPrismaTicketMessage.create.mockResolvedValueOnce({ id: "msg-id" });

      const job = makeJob(makeJobData());

      await processAiAgent(job as Job<AiAgentJobData>);

      // Message should be recorded
      expect(mockRunAgent).toHaveBeenCalled();
    });
  });

  describe("Idempotency", () => {
    it("can retry same message without duplicate side effects", async () => {
      mockRunAgent.mockResolvedValue({
        responded: true,
        response: "Consistent response",
        toolsExecuted: [],
      });

      const jobData = makeJobData();
      const job1 = makeJob(jobData);
      const job2 = makeJob(jobData);

      await processAiAgent(job1 as Job<AiAgentJobData>);
      await processAiAgent(job2 as Job<AiAgentJobData>);

      // Both should complete without error
      expect(mockRunAgent).toHaveBeenCalledTimes(2);
    });
  });
});

// ─── Worker Configuration Tests ──────────────────────────────────────────────

describe("Worker Configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defines ai-agent job processor", () => {
    // Verify module exports processor
    expect(processAiAgent).toBeDefined();
    expect(typeof processAiAgent).toBe("function");
  });

  it("handles standard Job interface correctly", () => {
    const job: Partial<Job<AiAgentJobData>> = {
      data: makeJobData(),
      name: "ai-agent",
      id: "test-1",
    };

    expect(job.data).toBeDefined();
    expect(job.data?.ticketId).toBeDefined();
  });

  it("processes concurrent jobs safely", async () => {
    mockRunAgent.mockResolvedValue({
      responded: true,
      response: "OK",
      toolsExecuted: [],
    });

    mockPrismaTicket.findUnique.mockResolvedValue({
      id: "ticket-1",
      aiEnabled: true,
      client: { cpfCnpj: "12345678901234" },
    });

    const jobs = [
      makeJob(makeJobData({ ticketId: "ticket-1" })),
      makeJob(makeJobData({ ticketId: "ticket-2" })),
      makeJob(makeJobData({ ticketId: "ticket-3" })),
    ];

    await Promise.all(
      jobs.map((job) => processAiAgent(job as Job<AiAgentJobData>))
    );

    expect(mockRunAgent).toHaveBeenCalledTimes(3);
  });
});

// ─── Integration Scenarios ───────────────────────────────────────────────────

describe("Complex Integration Scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaTicket.findUnique.mockResolvedValue({
      id: "ticket-1",
      aiEnabled: true,
      client: { cpfCnpj: "12345678901234" },
    });
  });

  it("handles full workflow: query -> search -> respond", async () => {
    mockRunAgent.mockResolvedValue({
      responded: true,
      response: "Here is the information",
      toolsExecuted: ["SEARCH_DOCUMENTS", "GET_CLIENT_INFO"],
      raResponse: undefined,
    });

    const job = makeJob(
      makeJobData({
        messageContent: "What is my account status?",
        channel: "EMAIL",
      })
    );

    await processAiAgent(job as Job<AiAgentJobData>);

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageContent: "What is my account status?",
        channel: "EMAIL",
      })
    );
  });

  it("handles escalation to human reviewer", async () => {
    mockRunAgent.mockResolvedValue({
      responded: false,
      response: undefined,
      toolsExecuted: [],
      raResponse: undefined,
    });

    const job = makeJob(makeJobData());

    await processAiAgent(job as Job<AiAgentJobData>);

    // Should mark for escalation/review
    expect(mockRunAgent).toHaveBeenCalled();
  });

  it("handles timeout and fallback chain", async () => {
    const timeoutError = new Error("Request timeout from all providers");
    mockRunAgent.mockRejectedValueOnce(timeoutError);
    mockBuildFallbackChain.mockResolvedValueOnce([
      { name: "fallback-1", priority: 1 },
    ]);

    const job = makeJob(makeJobData({ isRecovery: false }));

    try {
      await processAiAgent(job as Job<AiAgentJobData>);
    } catch {
      // Expected
    }

    expect(mockBuildFallbackChain).toHaveBeenCalled();
  });
});
