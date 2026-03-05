import { getSession } from "@/lib/session";
import { canAccessCompany } from "@/lib/rbac";
import { sseBus } from "@/lib/sse";

export const dynamic = "force-dynamic";

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      const unsubscribe = sseBus.subscribe(
        `company:${companyId}`,
        (event, data) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
          );
        }
      );

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
        unsubscribe();
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
