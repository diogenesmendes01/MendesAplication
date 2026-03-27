import { getSession } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { sseBus } from "@/lib/sse";

export const dynamic = "force-dynamic";

const ALLOWED_NAMESPACES = ["sac", "dashboard", "financial", "fiscal", "commercial", "system"];

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  if (!companyId) {
    return new Response("Missing companyId", { status: 400 });
  }

  const hasAccess = await canAccessCompany(
    session.userId,
    session.role,
    companyId
  );
  if (!hasAccess) {
    return new Response("Forbidden", { status: 403 });
  }

  // Parse namespace param — fallback to "system" for backward compat
  const nsParam = url.searchParams.get("ns");
  const namespaces = nsParam
    ? nsParam.split(",").filter((ns) => ALLOWED_NAMESPACES.includes(ns))
    : ["system"];

  if (namespaces.length === 0) {
    return new Response("No valid namespaces", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      // Subscribe to each namespace channel
      const unsubscribes: (() => void)[] = [];
      for (const ns of namespaces) {
        const unsub = sseBus.subscribe(
          `company:${companyId}:${ns}`,
          (event, data) => {
            controller.enqueue(
              encoder.encode(`event: ${ns}:${event}\ndata: ${data}\n\n`)
            );
          }
        );
        unsubscribes.push(unsub);
      }

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Cleanup on disconnect
      request.signal.addEventListener("abort", () => {
        unsubscribes.forEach((unsub) => unsub());
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
