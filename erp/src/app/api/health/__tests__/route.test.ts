import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

describe("GET /api/health", () => {
  it("should return status ok with timestamp", async () => {
    const req = new NextRequest("http://localhost/api/health");
    const response = await GET(req, {});
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.timestamp).toBeTruthy();
    // Verify timestamp is valid ISO string
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });
});
