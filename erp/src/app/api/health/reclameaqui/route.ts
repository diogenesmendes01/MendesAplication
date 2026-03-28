import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Channels without a sync in the last STALE_THRESHOLD_MS are considered stale. */
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export interface RaHealthChannel {
  channelId: string;
  companyId: string;
  lastSync: string | null;
  stale: boolean;
}

export interface RaHealthResponse {
  healthy: boolean;
  channels: RaHealthChannel[];
}

/**
 * GET /api/health/reclameaqui — no auth required.
 *
 * Returns the health status of all RECLAMEAQUI channels.
 * A channel is "stale" if its lastSyncAt is older than 30 minutes or null.
 * The overall response is "healthy" only when every active channel is non-stale.
 */
export async function GET(): Promise<NextResponse<RaHealthResponse>> {
  const channels = await prisma.channel.findMany({
    where: { type: "RECLAMEAQUI", isActive: true },
    select: { id: true, companyId: true, lastSyncAt: true },
  });

  const now = Date.now();

  const result: RaHealthChannel[] = channels.map((ch) => {
    const lastSync = ch.lastSyncAt ? ch.lastSyncAt.toISOString() : null;
    const stale = !ch.lastSyncAt || now - ch.lastSyncAt.getTime() > STALE_THRESHOLD_MS;

    return {
      channelId: ch.id,
      companyId: ch.companyId,
      lastSync,
      stale,
    };
  });

  const healthy = result.length > 0 && result.every((ch) => !ch.stale);

  return NextResponse.json({ healthy, channels: result });
}
