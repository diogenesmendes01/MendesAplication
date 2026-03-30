import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  verifyAccessToken: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/trace-context", () => {
  return {
    traceStore: {
      run: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
      getStore: vi.fn().mockReturnValue(null),
    },
  };
});

import { GET } from "../route";

describe("GET /api/health", () => {
  it("should return status ok with timestamp", async () => {
    const req = new NextRequest("http://localhost/api/health");
    const response = await GET(req, { params: Promise.resolve({}) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.timestamp).toBeTruthy();
    // Verify timestamp is valid ISO string
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });
});
