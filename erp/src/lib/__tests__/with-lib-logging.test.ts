import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockInfo, mockError, mockGetStore } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockError: vi.fn(),
  mockGetStore: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../logger")>();
  return {
    ...actual,
    createChildLogger: vi.fn(() => ({
      info: mockInfo,
      error: mockError,
      warn: vi.fn(),
    })),
  };
});

vi.mock("@/lib/trace-context", () => ({
  traceStore: { getStore: mockGetStore },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { withLibLogging } from "../with-lib-logging";
import { createChildLogger } from "@/lib/logger";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("withLibLogging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStore.mockReturnValue(null);
  });

  it("logs action.start and action.end on success path", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const wrapped = withLibLogging("worker.test", fn);

    const result = await wrapped();

    expect(result).toBe("ok");
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.any(Array) }),
      "action.start: worker.test",
    );
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", durationMs: expect.any(Number) }),
      "action.end: worker.test",
    );
    expect(mockError).not.toHaveBeenCalled();
  });

  it("logs action.error and re-throws on error path", async () => {
    const error = new Error("worker boom");
    const fn = vi.fn().mockRejectedValue(error);
    const wrapped = withLibLogging("worker.failing", fn);

    await expect(wrapped()).rejects.toBe(error);

    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorCode: expect.any(String),
        durationMs: expect.any(Number),
        err: expect.objectContaining({ message: "worker boom" }),
      }),
      "action.error: worker.failing",
    );
  });

  it("propagates traceId from traceStore when available", async () => {
    mockGetStore.mockReturnValue({ traceId: "trace-abc-123" });

    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = withLibLogging("worker.traced", fn);
    await wrapped();

    expect(createChildLogger).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "trace-abc-123" }),
    );
  });

  it("uses fallback UUID when traceId not in store (store is null)", async () => {
    mockGetStore.mockReturnValue(null);

    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = withLibLogging("worker.noTrace", fn);
    await wrapped();

    // When store is null, withLibLogging generates a random UUID as fallback
    expect(createChildLogger).toHaveBeenCalledWith(
      expect.objectContaining({ action: "worker.noTrace" }),
    );
    const callArg = (createChildLogger as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("preserves return value from wrapped function", async () => {
    const fn = vi.fn().mockResolvedValue({ id: 42, status: "done" });
    const wrapped = withLibLogging("worker.return", fn);

    const result = await wrapped();
    expect(result).toEqual({ id: 42, status: "done" });
  });

  it("passes all arguments through to the wrapped function", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const wrapped = withLibLogging("worker.args", fn);

    await wrapped("a", { b: 2 } as never);

    expect(fn).toHaveBeenCalledWith("a", { b: 2 });
  });

  it("sanitizes sensitive fields (password, token) in logged args without mutating originals", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const wrapped = withLibLogging("worker.sanitize", fn);

    const originalArg = { userId: "u1", password: "s3cr3t", token: "tok-xyz" };
    await wrapped(originalArg);

    // Underlying function receives the ORIGINAL (unsanitized) object
    expect(fn).toHaveBeenCalledWith({ userId: "u1", password: "s3cr3t", token: "tok-xyz" });

    // Logged args must have sensitive fields redacted
    const startCall = mockInfo.mock.calls.find((c) =>
      (c[1] as string).startsWith("action.start"),
    );
    const loggedArgs = startCall?.[0]?.args as Array<Record<string, unknown>>;
    expect(loggedArgs[0].userId).toBe("u1");
    expect(loggedArgs[0].password).toBe("[REDACTED]");
    expect(loggedArgs[0].token).toBe("[REDACTED]");
  });
});
