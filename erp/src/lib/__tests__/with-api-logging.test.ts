import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockInfo = vi.fn();
const mockWarn = vi.fn();
const mockError = vi.fn();

vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn(), child: vi.fn() };
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

// ─── Imports ──────────────────────────────────────────────────────────────────

import { withApiLogging } from "../with-api-logging";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(url = "http://localhost/api/test"): NextRequest {
  return new NextRequest(url);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("withApiLogging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs api.start and api.end on success", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withApiLogging("test.route", handler);

    const res = await wrapped(makeReq(), {});

    expect(res.status).toBe(200);
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/api/test" }),
      "api.start: test.route",
    );
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, durationMs: expect.any(Number) }),
      "api.end: test.route",
    );
  });

  it("returns 500 on unhandled error", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("kaboom"));
    const wrapped = withApiLogging("test.error", handler);

    const res = await wrapped(makeReq(), {});

    expect(res.status).toBe(500);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: expect.any(String),
        err: expect.objectContaining({ message: "kaboom" }),
      }),
      "api.error: test.error",
    );
  });

  it("re-throws Next.js redirect (object with digest)", async () => {
    const redirectError = { digest: "NEXT_REDIRECT", url: "/login" };
    const handler = vi.fn().mockRejectedValue(redirectError);
    const wrapped = withApiLogging("test.redirect", handler);

    await expect(wrapped(makeReq(), {})).rejects.toBe(redirectError);
    // Error should NOT have been logged
    expect(mockError).not.toHaveBeenCalled();
  });

  it("respects sampling — logs only a fraction of requests", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    // sampling: 0 → never log
    const wrapped = withApiLogging("test.sampled", handler, { sampling: 0 });

    const mockRandom = vi.spyOn(Math, "random").mockReturnValue(0.5);

    await wrapped(makeReq(), {});

    // With sampling=0, Math.random() (0.5) < 0 is false → no log
    expect(mockInfo).not.toHaveBeenCalled();

    mockRandom.mockRestore();
  });

  it("always logs errors even when sampling is 0", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("err"));
    const wrapped = withApiLogging("test.sampled-error", handler, { sampling: 0 });

    const mockRandom = vi.spyOn(Math, "random").mockReturnValue(0.5);

    await wrapped(makeReq(), {});

    // Even though sampling=0, errors ALWAYS log
    expect(mockError).toHaveBeenCalled();

    mockRandom.mockRestore();
  });

  it("logs when Math.random is below sampling rate", async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withApiLogging("test.sampled-hit", handler, { sampling: 0.5 });

    const mockRandom = vi.spyOn(Math, "random").mockReturnValue(0.3);

    await wrapped(makeReq(), {});

    // 0.3 < 0.5 → should log
    expect(mockInfo).toHaveBeenCalled();

    mockRandom.mockRestore();
  });
});
