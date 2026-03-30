import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findMany: (...a: unknown[]) => mockFindMany(...a) },
  },
}));

import { GET } from "../route";

const mockReq = new NextRequest("http://localhost/api/health/reclameaqui");

describe("GET /api/health/reclameaqui", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns healthy=true when all channels synced recently", async () => {
    const recentSync = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    mockFindMany.mockResolvedValue([
      { id: "ch1", companyId: "co1", lastSyncAt: recentSync },
      { id: "ch2", companyId: "co2", lastSyncAt: recentSync },
    ]);

    const res = await GET(mockReq, {});
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.healthy).toBe(true);
    expect(data.channels).toHaveLength(2);
    expect(data.channels[0].stale).toBe(false);
    expect(data.channels[1].stale).toBe(false);
  });

  it("returns healthy=false when a channel is stale (>30 min)", async () => {
    const staleSync = new Date(Date.now() - 45 * 60 * 1000); // 45 min ago
    const recentSync = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    mockFindMany.mockResolvedValue([
      { id: "ch1", companyId: "co1", lastSyncAt: recentSync },
      { id: "ch2", companyId: "co2", lastSyncAt: staleSync },
    ]);

    const res = await GET(mockReq, {});
    const data = await res.json();

    expect(data.healthy).toBe(false);
    expect(data.channels[0].stale).toBe(false);
    expect(data.channels[1].stale).toBe(true);
  });

  it("returns healthy=false when a channel has never synced (null)", async () => {
    mockFindMany.mockResolvedValue([
      { id: "ch1", companyId: "co1", lastSyncAt: null },
    ]);

    const res = await GET(mockReq, {});
    const data = await res.json();

    expect(data.healthy).toBe(false);
    expect(data.channels[0].stale).toBe(true);
    expect(data.channels[0].lastSync).toBeNull();
  });

  it("returns healthy=false when no channels exist", async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await GET(mockReq, {});
    const data = await res.json();

    expect(data.healthy).toBe(false);
    expect(data.channels).toHaveLength(0);
  });

  it("queries only active RECLAMEAQUI channels", async () => {
    mockFindMany.mockResolvedValue([]);

    await GET(mockReq, {});

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { type: "RECLAMEAQUI", isActive: true },
      select: { id: true, companyId: true, lastSyncAt: true },
    });
  });

  it("returns correct lastSync ISO string", async () => {
    const syncDate = new Date("2026-03-28T10:00:00.000Z");
    mockFindMany.mockResolvedValue([
      { id: "ch1", companyId: "co1", lastSyncAt: syncDate },
    ]);

    const res = await GET(mockReq, {});
    const data = await res.json();

    expect(data.channels[0].lastSync).toBe("2026-03-28T10:00:00.000Z");
    expect(data.channels[0].channelId).toBe("ch1");
    expect(data.channels[0].companyId).toBe("co1");
  });
});
