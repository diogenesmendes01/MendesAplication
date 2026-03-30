import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockInfo = vi.fn();
const mockError = vi.fn();

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

vi.mock("@/lib/session", () => ({
  getSession: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { withLogging } from "../with-logging";
import { sanitizeParams, truncateForLog, MAX_LOG_ARG_SIZE } from "../logger";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("withLogging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs action.start and action.end with success", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    const wrapped = withLogging("test.action", fn);

    await wrapped("arg1");

    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "action.start: test.action",
    );
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", durationMs: expect.any(Number) }),
      "action.end: test.action",
    );
  });

  it("logs action.error when fn throws", async () => {
    const error = new Error("boom");
    const fn = vi.fn().mockRejectedValue(error);
    const wrapped = withLogging("test.failing", fn);

    await expect(wrapped()).rejects.toThrow("boom");

    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorCode: expect.any(String),
        err: expect.objectContaining({ message: "boom" }),
      }),
      "action.error: test.failing",
    );
  });

  it("re-throws the original error (does not swallow)", async () => {
    const error = new Error("original error");
    const fn = vi.fn().mockRejectedValue(error);
    const wrapped = withLogging("test.rethrow", fn);

    await expect(wrapped()).rejects.toBe(error);
  });

  it("preserves return type", async () => {
    const fn = vi.fn().mockResolvedValue({ id: 1, name: "test" });
    const wrapped = withLogging("test.return", fn);

    const result = await wrapped();
    expect(result).toEqual({ id: 1, name: "test" });
  });
});

describe("sanitizeParams", () => {
  it("redacts password and token fields", () => {
    const result = sanitizeParams({
      name: "John",
      password: "secret123",
      token: "abc-token",
      apiKey: "sk-123",
    });

    expect(result.name).toBe("John");
    expect(result.password).toBe("[REDACTED]");
    expect(result.token).toBe("[REDACTED]");
    expect(result.apiKey).toBe("[REDACTED]");
  });

  it("treats arrays recursively", () => {
    const result = sanitizeParams({
      items: [
        { name: "item1", password: "secret" },
        { name: "item2", token: "tok" },
      ],
    });

    const items = result.items as Record<string, unknown>[];
    expect(items[0].name).toBe("item1");
    expect(items[0].password).toBe("[REDACTED]");
    expect(items[1].token).toBe("[REDACTED]");
  });
});

describe("truncateForLog", () => {
  it("truncates strings larger than MAX_LOG_ARG_SIZE", () => {
    const bigString = "x".repeat(MAX_LOG_ARG_SIZE + 100);
    const result = truncateForLog(bigString) as string;

    expect(result.length).toBeLessThan(bigString.length);
    expect(result).toContain("...[truncated, original");
    expect(result).toContain(`${bigString.length} chars]`);
  });

  it("returns small strings as-is", () => {
    expect(truncateForLog("hello")).toBe("hello");
  });

  it("truncates arrays with > 100 items", () => {
    const bigArray = Array.from({ length: 150 }, (_, i) => i);
    const result = truncateForLog(bigArray) as unknown[];

    expect(result.length).toBe(101); // 100 items + indicator
    expect(result[100]).toContain("150 items, showing first 100");
  });

  it("returns null/undefined as-is", () => {
    expect(truncateForLog(null)).toBeNull();
    expect(truncateForLog(undefined)).toBeUndefined();
  });

  it("returns small arrays as-is", () => {
    const arr = [1, 2, 3];
    expect(truncateForLog(arr)).toEqual([1, 2, 3]);
  });

  it("truncates large objects based on JSON size", () => {
    const bigObj: Record<string, string> = {};
    for (let i = 0; i < 500; i++) {
      bigObj[`key_${i}`] = "x".repeat(50);
    }
    const result = truncateForLog(bigObj);
    expect(typeof result).toBe("string");
    expect((result as string)).toContain("...[truncated, original");
  });
});
