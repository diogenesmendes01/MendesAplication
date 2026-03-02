import { NextResponse } from "next/server";

const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";

export async function POST(request: Request) {
  // Validate API key from header or query param
  const apiKey =
    request.headers.get("apikey") ??
    new URL(request.url).searchParams.get("apikey");

  if (!EVOLUTION_API_KEY || apiKey !== EVOLUTION_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data = payload as Record<string, unknown>;

  // Only process messages.upsert events
  if (data.event !== "messages.upsert") {
    return NextResponse.json({ ok: true });
  }

  // Enqueue for async processing
  try {
    const { whatsappInboundQueue } = await import("@/lib/queue");
    await whatsappInboundQueue.add("process-inbound", data);
  } catch (err) {
    console.error("[webhook/whatsapp] Failed to enqueue:", err);
    return NextResponse.json(
      { error: "Failed to enqueue message" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
