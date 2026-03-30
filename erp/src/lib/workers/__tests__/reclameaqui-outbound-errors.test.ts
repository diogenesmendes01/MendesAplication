/**
 * Unit tests for error classification in the RA outbound worker.
 * Verifies retriable vs permanent error codes are correctly classified.
 */
import { describe, it, expect, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/encryption", () => ({ decryptConfig: vi.fn() }));
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
vi.mock("@/lib/sse", () => ({
  sseBus: { publish: vi.fn() },
}));
vi.mock("@/lib/reclameaqui/client", () => {
  class ReclameAquiError extends Error {
    public readonly code: number;
    public readonly httpStatus: number;
    public readonly originalMessage: string;
    constructor(message: string, code: number, httpStatus = 0, originalMessage = "") {
      super(message);
      this.name = "ReclameAquiError";
      this.code = code;
      this.httpStatus = httpStatus;
      this.originalMessage = originalMessage;
    }
  }
  return {
    ReclameAquiError,
    ReclameAquiClient: vi.fn(),
  };
});

import { isRetriableError } from "../reclameaqui-outbound";
import { ReclameAquiError } from "@/lib/reclameaqui/client";

describe("isRetriableError", () => {
  describe("retriable errors (should return true)", () => {
    it("rate limit error (4290)", () => {
      expect(isRetriableError(new ReclameAquiError("Rate limit", 4290, 0, "Rate limit"))).toBe(true);
    });

    it("internal server error (5000)", () => {
      expect(isRetriableError(new ReclameAquiError("Server error", 5000, 0, "Server error"))).toBe(true);
    });

    it("service unavailable (5030)", () => {
      expect(isRetriableError(new ReclameAquiError("Unavailable", 5030, 0, "Unavailable"))).toBe(true);
    });

    it("network errors (plain Error)", () => {
      expect(isRetriableError(new Error("ECONNRESET"))).toBe(true);
    });

    it("timeout errors", () => {
      expect(isRetriableError(new Error("ETIMEDOUT"))).toBe(true);
    });

    it("unknown non-ReclameAquiError types", () => {
      expect(isRetriableError("string error")).toBe(true);
      expect(isRetriableError(null)).toBe(true);
      expect(isRetriableError(undefined)).toBe(true);
    });

    it("unknown RA error code defaults to retriable", () => {
      expect(isRetriableError(new ReclameAquiError("Unknown", 9999, 0, "Unknown"))).toBe(true);
    });
  });

  describe("permanent errors (should return false)", () => {
    const permanentCodes = [
      [4090, "Ticket inactive"],
      [4091, "Not RA ticket"],
      [4095, "Already rated"],
      [4096, "Not eligible for evaluation"],
      [4098, "Attachment limit exceeded"],
      [4099, "Daily moderation limit exceeded"],
      [40910, "Moderation per complaint limit"],
      [40912, "Moderation by duplicity impossible"],
      [40913, "Moderation requires public response"],
      [40914, "Moderation reason not allowed"],
      [40915, "Not RA ticket (moderation)"],
      [40916, "Pending moderation"],
      [40917, "Moderation already requested"],
      [40919, "Source doesn't support private messages"],
      [40920, "Ticket closed"],
      [40922, "Unsupported attachment type"],
      [40925, "Private message already finished"],
      [40930, "Duplicate message"],
    ] as const;

    it.each(permanentCodes)("code %d (%s)", (code, desc) => {
      expect(isRetriableError(new ReclameAquiError(desc, code, 0, desc))).toBe(false);
    });
  });
});
