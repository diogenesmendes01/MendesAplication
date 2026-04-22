/**
 * Tests for AI Provider Health Checker
 */
import { describe, it, expect, vi, beforeEach, afterEach as _afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiProviderHealth: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    aiProviderIncident: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    aiConfig: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  chatCompletion: vi.fn(),
}));

vi.mock("@/lib/sse", () => ({
  sseBus: { publish: vi.fn() },
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

vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((x: string) => `decrypted_${x}`),
}));

import { checkProviderHealth, getPreviousStatus, recordHealthCheck, areAllProvidersDown, cleanupOldHealthChecks } from "../health-checker";
import { chatCompletion } from "../provider";
import { prisma } from "@/lib/prisma";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("checkProviderHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns UP when provider responds quickly", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: "OK",
      usage: { inputTokens: 5, outputTokens: 1 },
    });

    const result = await checkProviderHealth({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-key",
    });

    expect(result.status).toBe("up");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.errorMessage).toBeNull();
  });

  it("returns DOWN when provider throws error", async () => {
    vi.mocked(chatCompletion).mockRejectedValueOnce(
      new Error("OpenAI API error 503: [provider error body redacted]"),
    );

    const result = await checkProviderHealth({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-key",
    });

    expect(result.status).toBe("down");
    expect(result.errorMessage).toContain("503");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns DOWN on timeout", async () => {
    vi.mocked(chatCompletion).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 15_000)),
    );

    const result = await checkProviderHealth({
      provider: "anthropic",
      model: "claude-haiku-4-20250414",
      apiKey: "test-key",
    });

    expect(result.status).toBe("down");
    expect(result.errorMessage).toContain("timeout");
  }, 15_000);
});

describe("getPreviousStatus", () => {
  it("returns null when no previous health check exists", async () => {
    vi.mocked(prisma.aiProviderHealth.findFirst).mockResolvedValueOnce(null);

    const status = await getPreviousStatus("openai", "gpt-4o-mini");
    expect(status).toBeNull();
  });

  it("returns previous status when exists", async () => {
    vi.mocked(prisma.aiProviderHealth.findFirst).mockResolvedValueOnce({
      id: "1",
      provider: "openai",
      model: "gpt-4o-mini",
      status: "up",
      latencyMs: 500,
      errorMessage: null,
      checkedAt: new Date(),
    });

    const status = await getPreviousStatus("openai", "gpt-4o-mini");
    expect(status).toBe("up");
  });
});

describe("recordHealthCheck", () => {
  it("creates health check record in database", async () => {
    await recordHealthCheck({
      provider: "openai",
      model: "gpt-4o-mini",
      status: "up",
      latencyMs: 800,
      errorMessage: null,
    });

    expect(prisma.aiProviderHealth.create).toHaveBeenCalledWith({
      data: {
        provider: "openai",
        model: "gpt-4o-mini",
        status: "up",
        latencyMs: 800,
        errorMessage: null,
      },
    });
  });
});

describe("areAllProvidersDown", () => {
  it("returns false when no providers are configured", async () => {
    vi.mocked(prisma.aiProviderHealth.findMany).mockResolvedValueOnce([]);
    expect(await areAllProvidersDown()).toBe(false);
  });

  it("returns true when all providers are down", async () => {
    vi.mocked(prisma.aiProviderHealth.findMany).mockResolvedValueOnce([
      { id: "h1", provider: "openai", model: "gpt-4o-mini", status: "down", latencyMs: null, errorMessage: null, checkedAt: new Date() },
      { id: "h2", provider: "anthropic", model: "claude-haiku-4-20250414", status: "down", latencyMs: null, errorMessage: null, checkedAt: new Date() },
    ] as never);

    expect(await areAllProvidersDown()).toBe(true);
  });

  it("returns false when at least one provider is up", async () => {
    vi.mocked(prisma.aiProviderHealth.findMany).mockResolvedValueOnce([
      { id: "h3", provider: "openai", model: "gpt-4o-mini", status: "down", latencyMs: null, errorMessage: null, checkedAt: new Date() },
      { id: "h4", provider: "anthropic", model: "claude-haiku-4-20250414", status: "up", latencyMs: 800, errorMessage: null, checkedAt: new Date() },
    ] as never);

    expect(await areAllProvidersDown()).toBe(false);
  });
});

describe("cleanupOldHealthChecks", () => {
  it("deletes records older than retention period", async () => {
    vi.mocked(prisma.aiProviderHealth.deleteMany).mockResolvedValueOnce({ count: 42 });

    const deleted = await cleanupOldHealthChecks(7);
    expect(deleted).toBe(42);
    expect(prisma.aiProviderHealth.deleteMany).toHaveBeenCalledWith({
      where: {
        checkedAt: { lt: expect.any(Date) },
      },
    });
  });
});
