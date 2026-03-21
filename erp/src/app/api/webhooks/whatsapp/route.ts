import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const WHATSAPP_WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || "";

export async function POST(request: Request) {
  // Validate webhook secret from header or query param
  const apiKey =
    request.headers.get("apikey") ??
    new URL(request.url).searchParams.get("apikey");

  if (!WHATSAPP_WEBHOOK_SECRET || apiKey !== WHATSAPP_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data = payload as Record<string, unknown>;
  const event = data.event as string;

  // Only process known event types
  if (event !== "messages.upsert" && event !== "message.media") {
    return NextResponse.json({ ok: true });
  }

  // Enqueue for async processing
  try {
    const { whatsappInboundQueue } = await import("@/lib/queue");
    const jobName = event === "message.media" ? "process-media" : "process-inbound";
    await whatsappInboundQueue.add(jobName, data);
  } catch (err) {
    logger.error("[webhook/whatsapp] Failed to enqueue:", err);
    return NextResponse.json(
      { error: "Failed to enqueue message" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
