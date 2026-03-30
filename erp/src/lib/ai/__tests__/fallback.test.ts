/**
 * Tests for AI Fallback Chain
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiProviderHealth: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    aiConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  chatCompletion: vi.fn(),
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

import { chatCompletionWithFallback, isProviderError } from "../fallback";
import type { FallbackProviderConfig } from "../fallback";
import { chatCompletion } from "../provider";
import { prisma } from "@/lib/prisma";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("isProviderError", () => {
  it.each([
    ["timeout", true],
    ["503 Service Unavailable", true],
    ["502 Bad Gateway", true],
    ["429 rate limit exceeded", true],
    ["connection refused (ECONNREFUSED)", true],
    ["fetch failed", true],
    ["Invalid API key", false],
    ["Model not found", false],
    ["Something unexpected", false],
  ])('classifies "%s" as provider error: %s', (message, expected) => {
    expect(isProviderError(new Error(message))).toBe(expected);
  });

  it("returns false for non-Error values", () => {
    expect(isProviderError("string error")).toBe(false);
    expect(isProviderError(null)).toBe(false);
    expect(isProviderError(undefined)).toBe(false);
  });
});

describe("chatCompletionWithFallback", () => {
  const chain: FallbackProviderConfig[] = [
    { provider: "openai", model: "gpt-4o-mini", apiKey: "key1" },
    { provider: "anthropic", model: "claude-haiku-4-20250414", apiKey: "key2" },
    { provider: "openai", model: "gpt-3.5-turbo", apiKey: "key3" },
  ];

  const messages = [{ role: "user" as const, content: "Hello" }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when chain is empty", async () => {
    await expect(
      chatCompletionWithFallback(messages, undefined, []),
    ).rejects.toThrow("Fallback chain is empty");
  });

  it("uses primary provider when it succeeds", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: "Hello!",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await chatCompletionWithFallback(messages, undefined, chain);

    expect(result.usedProvider).toBe("openai");
    expect(result.usedModel).toBe("gpt-4o-mini");
    expect(result.usedFallback).toBe(false);
    expect(result.chainIndex).toBe(0);
    expect(result.content).toBe("Hello!");
  });

  it("falls back to secondary when primary fails", async () => {
    vi.mocked(chatCompletion)
      .mockRejectedValueOnce(new Error("OpenAI API error 503"))
      .mockResolvedValueOnce({
        content: "Hi from Anthropic!",
        usage: { inputTokens: 10, outputTokens: 5 },
      });

    const result = await chatCompletionWithFallback(messages, undefined, chain);

    expect(result.usedProvider).toBe("anthropic");
    expect(result.usedModel).toBe("claude-haiku-4-20250414");
    expect(result.usedFallback).toBe(true);
    expect(result.chainIndex).toBe(1);
  });

  it("falls back to tertiary when primary and secondary fail", async () => {
    vi.mocked(chatCompletion)
      .mockRejectedValueOnce(new Error("OpenAI API error 503"))
      .mockRejectedValueOnce(new Error("Anthropic API error 502"))
      .mockResolvedValueOnce({
        content: "Fallback response",
        usage: { inputTokens: 10, outputTokens: 5 },
      });

    const result = await chatCompletionWithFallback(messages, undefined, chain);

    expect(result.usedProvider).toBe("openai");
    expect(result.usedModel).toBe("gpt-3.5-turbo");
    expect(result.usedFallback).toBe(true);
    expect(result.chainIndex).toBe(2);
  });

  it("throws when all providers fail", async () => {
    vi.mocked(chatCompletion)
      .mockRejectedValueOnce(new Error("OpenAI error 503"))
      .mockRejectedValueOnce(new Error("Anthropic error 502"))
      .mockRejectedValueOnce(new Error("GPT-3.5 error 500"));

    await expect(
      chatCompletionWithFallback(messages, undefined, chain),
    ).rejects.toThrow("All providers in fallback chain failed");
  });

  it("skips providers known to be down", async () => {
    // Mock: openai is "down" in last health check
    vi.mocked(prisma.aiProviderHealth.findFirst)
      .mockResolvedValueOnce({
        id: "1", provider: "openai", model: "gpt-4o-mini",
        status: "down", latencyMs: null, errorMessage: "503", checkedAt: new Date(),
      } as never)
      .mockResolvedValueOnce(null); // anthropic - no previous check

    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: "Hi from Anthropic!",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await chatCompletionWithFallback(messages, undefined, chain);

    // Should have skipped openai and gone straight to anthropic
    expect(result.usedProvider).toBe("anthropic");
    expect(result.chainIndex).toBe(1);
    // chatCompletion should only have been called once (for anthropic)
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it("still tries last provider even if known down", async () => {
    // All providers "down" in health check
    vi.mocked(prisma.aiProviderHealth.findFirst)
      .mockResolvedValueOnce({ id: "x", provider: "x", model: "x", status: "down", latencyMs: null, errorMessage: null, checkedAt: new Date() } as never)
      .mockResolvedValueOnce({ id: "x", provider: "x", model: "x", status: "down", latencyMs: null, errorMessage: null, checkedAt: new Date() } as never)
      .mockResolvedValueOnce({ id: "x", provider: "x", model: "x", status: "down", latencyMs: null, errorMessage: null, checkedAt: new Date() } as never); // Not actually checked for last

    vi.mocked(chatCompletion)
      .mockRejectedValueOnce(new Error("error"))
      .mockResolvedValueOnce({ content: "Last resort!", usage: { inputTokens: 5, outputTokens: 2 } });

    // chain[0] skipped (down), chain[1] skipped (down), chain[2] is last — must try
    const result = await chatCompletionWithFallback(messages, undefined, chain);
    expect(result.usedProvider).toBe("openai");
    expect(result.usedModel).toBe("gpt-3.5-turbo");
  });

  it("passes temperature and maxTokens options", async () => {
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      content: "OK",
      usage: { inputTokens: 5, outputTokens: 1 },
    });

    await chatCompletionWithFallback(messages, undefined, chain, {
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(chatCompletion).toHaveBeenCalledWith(
      messages,
      undefined,
      expect.objectContaining({
        temperature: 0.5,
        maxTokens: 100,
      }),
    );
  });
});
