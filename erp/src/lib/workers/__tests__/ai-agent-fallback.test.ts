/**
 * Tests for AI Agent Worker — Fallback Chain Integration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunAgent = vi.fn();
const mockBuildFallbackChain = vi.fn().mockResolvedValue([]);
const mockMarkTicketPendingRecovery = vi.fn().mockResolvedValue(undefined);
const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true });
const mockResolveAiConfigSelect = vi.fn().mockResolvedValue({
  operationMode: "auto",
  hybridThreshold: 0.8,
  alwaysRequireApproval: [],
  raMode: null,
  raEscalationKeywords: [],
  raPrivateBeforePublic: true,
  raAutoRequestEvaluation: false,
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
    ticketMessage: { create: vi.fn().mockResolvedValue({}) },
    aiConfig: { findFirst: vi.fn().mockResolvedValue(null) },
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
  calculateConfidence: vi.fn().mockReturnValue(0.5),
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

import { processAiAgent } from "../ai-agent";
import type { Job } from "bullmq";

function createJob(data: Record<string, unknown>): Job {
  return {
    data: {
      ticketId: "ticket-1",
      companyId: "company-1",
      messageContent: "Hello",
      channel: "WHATSAPP",
      ...data,
    },
    moveToDelayed: vi.fn(),
    token: "token",
  } as unknown as Job;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("processAiAgent — fallback integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds fallback chain and passes to runAgent", async () => {
    const chain = [
      { provider: "openai", model: "gpt-4o-mini", apiKey: "key1" },
      { provider: "anthropic", model: "claude-haiku-4-20250414", apiKey: "key2" },
    ];
    mockBuildFallbackChain.mockResolvedValueOnce(chain);
    mockRunAgent.mockResolvedValueOnce({
      responded: true,
      escalated: false,
      iterations: 1,
    });

    await processAiAgent(createJob({}));

    expect(mockBuildFallbackChain).toHaveBeenCalledWith("company-1", "WHATSAPP");
    expect(mockRunAgent).toHaveBeenCalledWith(
      "ticket-1",
      "company-1",
      "Hello",
      "WHATSAPP",
      expect.objectContaining({
        fallbackChain: chain,
      }),
    );
  });

  it("does not pass fallbackChain if only one provider", async () => {
    mockBuildFallbackChain.mockResolvedValueOnce([
      { provider: "openai", model: "gpt-4o-mini", apiKey: "key1" },
    ]);
    mockRunAgent.mockResolvedValueOnce({
      responded: true,
      escalated: false,
      iterations: 1,
    });

    await processAiAgent(createJob({}));

    expect(mockRunAgent).toHaveBeenCalledWith(
      "ticket-1",
      "company-1",
      "Hello",
      "WHATSAPP",
      expect.objectContaining({
        fallbackChain: undefined,
      }),
    );
  });

  it("marks ticket for recovery on provider error", async () => {
    mockBuildFallbackChain.mockResolvedValueOnce([]);
    mockRunAgent.mockRejectedValueOnce(
      new Error("All providers in fallback chain failed: openai/gpt-4o-mini: 503"),
    );

    await processAiAgent(createJob({}));

    expect(mockMarkTicketPendingRecovery).toHaveBeenCalledWith("ticket-1");
  });

  it("re-throws non-provider errors", async () => {
    mockBuildFallbackChain.mockResolvedValueOnce([]);
    mockRunAgent.mockRejectedValueOnce(new Error("Invalid API key"));

    await expect(processAiAgent(createJob({}))).rejects.toThrow("Invalid API key");
    expect(mockMarkTicketPendingRecovery).not.toHaveBeenCalled();
  });

  it("marks RA ticket for recovery on provider error", async () => {
    mockBuildFallbackChain.mockResolvedValueOnce([]);
    mockRunAgent.mockRejectedValueOnce(new Error("503 Service Unavailable"));

    await processAiAgent(createJob({ channel: "RECLAMEAQUI" }));

    expect(mockMarkTicketPendingRecovery).toHaveBeenCalledWith("ticket-1");
  });

  it("logs recovery job processing", async () => {
    mockBuildFallbackChain.mockResolvedValueOnce([]);
    mockRunAgent.mockResolvedValueOnce({
      responded: true,
      escalated: false,
      iterations: 1,
    });

    await processAiAgent(createJob({ isRecovery: true }));

    // Should have logged the recovery info
    const { logger } = await import("@/lib/logger");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("recovery"),
    );
  });
});
