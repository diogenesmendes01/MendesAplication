# Advanced Performance Optimizations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate remaining performance bottlenecks — consolidate auth per request, replace polling with SSE, add a KPI read model with cache, and enable concurrent WhatsApp message processing.

**Architecture:** Four independent improvement tracks: (1) request-scoped auth avoids redundant JWT/DB checks by passing verified session to sub-functions, (2) SSE endpoint streams ticket/SLA events replacing 3 polling loops, (3) KPI summary cache consolidates 10+ count queries into a single cached read, (4) WhatsApp provider processes messages concurrently with semaphore-limited parallelism and BullMQ worker concurrency.

**Tech Stack:** Next.js 14.2, Prisma 6, BullMQ, Server-Sent Events (native `ReadableStream`), TypeScript strict

---

## Track 1: Consolidate Auth Per Request

Currently `requireCompanyAccess` is called 37× across `actions.ts`. Bootstrap functions call it once, then each sub-function calls it again (10 redundant calls per detail page load). Even with the 30s cache, each call still reads cookies + verifies JWT + checks cache.

### Task 1: Create internal auth-skipping versions of bootstrap sub-functions

**Files:**
- Modify: `erp/src/app/(app)/sac/tickets/actions.ts`

**Context:** `getTicketDetailBootstrap` calls `requireCompanyAccess` at the top, then calls 7 sub-functions that each call `requireCompanyAccess` again. We'll create internal versions that accept a pre-verified session.

**Step 1: Add `_internal` suffix pattern for sub-functions used by bootstraps**

At the top of the file, after imports, add a type alias:

```typescript
import type { JwtPayload } from "@/lib/auth";
```

Then create internal versions of the 7 functions called by `getTicketDetailBootstrap`. Each internal version accepts a `session: JwtPayload` parameter instead of calling `requireCompanyAccess`:

For `getTicketById` — create `_getTicketByIdInternal`:
```typescript
async function _getTicketByIdInternal(
  ticketId: string,
  companyId: string,
  _session: JwtPayload
): Promise<TicketDetail | null> {
  // Same body as getTicketById but WITHOUT the requireCompanyAccess call
  // Copy the full implementation starting from the prisma query
}
```

Do the same for:
- `getClientFinancialSummary` → `_getClientFinancialSummaryInternal`
- `getTicketRefunds` → `_getTicketRefundsInternal`
- `getCancellationInfo` → `_getCancellationInfoInternal`
- `getAiConfigEnabled` → `_getAiConfigEnabledInternal`
- `listUsersForAssign` → `_listUsersForAssignInternal`
- `getUserRole` → `_getUserRoleInternal`

**Important:** The exported public versions remain unchanged — they still call `requireCompanyAccess`. Only the internal versions skip it.

**Step 2: Update `getTicketDetailBootstrap` to use internal versions**

```typescript
export async function getTicketDetailBootstrap(
  ticketId: string,
  companyId: string
): Promise<TicketDetailBootstrap | null> {
  const session = await requireCompanyAccess(companyId); // ← single auth check

  const ticket = await _getTicketByIdInternal(ticketId, companyId, session);
  if (!ticket) return null;

  const [financialSummary, refunds, cancellation, aiEnabled, users, userRole] =
    await Promise.all([
      _getClientFinancialSummaryInternal(ticket.client.id, companyId, session),
      _getTicketRefundsInternal(ticketId, companyId, session),
      _getCancellationInfoInternal(ticketId, companyId, session),
      _getAiConfigEnabledInternal(companyId, session),
      _listUsersForAssignInternal(companyId, session),
      _getUserRoleInternal(companyId, session),
    ]);

  return { ticket, financialSummary, refunds, cancellation, aiEnabled, users, userRole };
}
```

**Step 3: Refactor original exported functions to call internal versions**

For each of the 7 functions, refactor the exported version into a thin wrapper:

```typescript
export async function getTicketById(
  ticketId: string,
  companyId: string
): Promise<TicketDetail | null> {
  const session = await requireCompanyAccess(companyId);
  return _getTicketByIdInternal(ticketId, companyId, session);
}
```

This avoids code duplication — the logic lives in the `_internal` version, and both the public function and the bootstrap call the same code.

**Step 4: Do the same for `getTicketListBootstrap`**

`getTicketListBootstrap` calls 3 sub-functions: `listTickets`, `getTicketTabCounts`, `getSlaAlertCounts`. Create internal versions and update the bootstrap.

**Step 5: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 6: Commit**

```bash
git add erp/src/app/\(app\)/sac/tickets/actions.ts
git commit -m "perf: consolidate auth per request — internal functions skip redundant requireCompanyAccess"
```

---

## Track 2: Replace Polling with SSE

Three polling loops exist: sidebar SLA badge (60s), ticket timeline (10s), WhatsApp status (5s). We'll create an SSE endpoint and replace the two highest-impact ones (sidebar + timeline). WhatsApp status polling stays — it only runs during connection setup dialog.

### Task 2: Create SSE infrastructure — event stream API route

**Files:**
- Create: `erp/src/app/api/events/route.ts`
- Create: `erp/src/lib/sse.ts`

**Step 1: Create the SSE event bus**

`erp/src/lib/sse.ts` — a simple pub/sub for server-side event broadcasting:

```typescript
type Listener = (event: string, data: string) => void;

class SSEBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(channel: string, listener: Listener): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(listener);
    return () => {
      this.listeners.get(channel)?.delete(listener);
      if (this.listeners.get(channel)?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  publish(channel: string, event: string, data: unknown): void {
    const listeners = this.listeners.get(channel);
    if (!listeners) return;
    const json = JSON.stringify(data);
    for (const listener of listeners) {
      listener(event, json);
    }
  }
}

export const sseBus = new SSEBus();
```

**Step 2: Create the SSE API route**

`erp/src/app/api/events/route.ts`:

```typescript
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

  const hasAccess = await canAccessCompany(session.userId, session.role, companyId);
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
        try { controller.close(); } catch {}
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
```

**Step 3: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add erp/src/lib/sse.ts erp/src/app/api/events/route.ts
git commit -m "feat: SSE infrastructure — event bus + streaming API route"
```

---

### Task 3: Create SSE React hook

**Files:**
- Create: `erp/src/hooks/use-event-stream.ts`

**Step 1: Create the hook**

```typescript
"use client";

import { useEffect, useRef, useCallback } from "react";

type EventHandler = (data: unknown) => void;

export function useEventStream(
  companyId: string | null,
  handlers: Record<string, EventHandler>
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (!companyId) return undefined;

    const es = new EventSource(`/api/events?companyId=${companyId}`);

    // Register handlers for each event type
    for (const eventName of Object.keys(handlersRef.current)) {
      es.addEventListener(eventName, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          handlersRef.current[eventName]?.(data);
        } catch {
          console.warn(`[SSE] Failed to parse ${eventName}:`, e.data);
        }
      });
    }

    es.onerror = () => {
      es.close();
      // Reconnect after 5 seconds
      setTimeout(() => connect(), 5000);
    };

    return es;
  }, [companyId]);

  useEffect(() => {
    const es = connect();
    return () => es?.close();
  }, [connect]);
}
```

**Step 2: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add erp/src/hooks/use-event-stream.ts
git commit -m "feat: useEventStream React hook for SSE consumption"
```

---

### Task 4: Emit SSE events from ticket mutations and wire up sidebar

**Files:**
- Modify: `erp/src/app/(app)/sac/tickets/actions.ts` — emit events after mutations
- Modify: `erp/src/components/sidebar.tsx` — replace polling with SSE
- Modify: `erp/src/app/(app)/sac/tickets/dashboard-actions.ts` — emit after dashboard invalidation

**Step 1: Add SSE emission to ticket mutations**

In `actions.ts`, after any action that changes ticket status, SLA, or refund status, add:

```typescript
import { sseBus } from "@/lib/sse";
```

Then at the end of functions like `updateTicketStatus`, `requestRefund`, `approveRefund`, `createTicket`, etc.:

```typescript
// After successful mutation
sseBus.publish(`company:${companyId}`, "sla-update", { timestamp: Date.now() });
```

For timeline-affecting actions (`createTicketReply`, `createInternalNote`, `sendWhatsAppMessage`, `sendEmailReply`):

```typescript
sseBus.publish(`company:${companyId}`, "timeline-update", {
  ticketId,
  timestamp: Date.now(),
});
```

**Step 2: Replace sidebar polling with SSE**

In `sidebar.tsx`, replace the `setInterval` polling with `useEventStream`:

```typescript
import { useEventStream } from "@/hooks/use-event-stream";

// Replace the useEffect with setInterval:
useEventStream(selectedCompanyId, {
  "sla-update": () => {
    fetchBadge(); // Re-fetch SLA counts on event
  },
});

// Keep the initial fetch on mount/company change:
useEffect(() => {
  fetchBadge();
}, [selectedCompanyId]);
```

Remove the `setInterval` and its cleanup.

**Step 3: Also emit from the WhatsApp inbound worker**

In `erp/src/lib/workers/whatsapp-inbound.ts`, after creating a ticket message:

```typescript
import { sseBus } from "@/lib/sse";

// After creating the message (near line 442):
sseBus.publish(`company:${companyId}`, "timeline-update", {
  ticketId,
  timestamp: Date.now(),
});
```

**Step 4: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 5: Commit**

```bash
git add erp/src/app/\(app\)/sac/tickets/actions.ts erp/src/components/sidebar.tsx erp/src/lib/workers/whatsapp-inbound.ts erp/src/app/\(app\)/sac/tickets/dashboard-actions.ts
git commit -m "feat: emit SSE events from mutations, replace sidebar polling"
```

---

### Task 5: Replace timeline polling with SSE

**Files:**
- Modify: `erp/src/app/(app)/sac/tickets/[id]/ticket-timeline.tsx`

**Step 1: Add SSE listener for timeline updates**

Import the hook and use it alongside (or replacing) the existing polling:

```typescript
import { useEventStream } from "@/hooks/use-event-stream";
```

In the component body, add:

```typescript
useEventStream(companyId, {
  "timeline-update": (data: unknown) => {
    const event = data as { ticketId: string; timestamp: number };
    if (event.ticketId === ticketId) {
      pollNewEvents(); // Reuse existing incremental fetch
    }
  },
});
```

Then remove or reduce the `setInterval` polling. Keep a fallback poll at 60s (instead of 10s) for robustness if SSE connection drops:

```typescript
// Change from 10s to 60s fallback:
const interval = setInterval(() => {
  pollNewEvents();
}, 60_000);
```

**Step 2: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add erp/src/app/\(app\)/sac/tickets/\[id\]/ticket-timeline.tsx
git commit -m "feat: replace 10s timeline polling with SSE, keep 60s fallback"
```

---

## Track 3: KPI Read Model with Cache

Instead of running 10+ count queries on every dashboard load (even with 30s cache), consolidate into a single cached summary that's invalidated on mutation.

### Task 6: Create KPI cache module

**Files:**
- Create: `erp/src/lib/kpi-cache.ts`

**Step 1: Create the centralized KPI cache**

```typescript
import { prisma } from "@/lib/prisma";
import { getSlaStatus } from "@/lib/sla";

export interface CompanyKpiSummary {
  openCount: number;
  inProgressCount: number;
  waitingClientCount: number;
  resolvedTodayCount: number;
  slaBreachedCount: number;
  slaAtRiskCount: number;
  pendingRefundsCount: number;
  avgResponseTimeMinutes: number;
  ticketsByChannel: { channel: string; count: number }[];
  ticketsByPriority: { priority: string; count: number }[];
  // Used by sidebar
  slaAlertBreached: number;
  slaAlertAtRisk: number;
  // Used by tab counts
  slaCriticalCount: number;
  refundsPendingCount: number;
}

const kpiCache = new Map<string, { data: CompanyKpiSummary; timestamp: number }>();
const KPI_CACHE_TTL = 15_000; // 15 seconds — covers both dashboard (30s) and SLA (60s) polling

export function invalidateKpiCache(companyId: string): void {
  kpiCache.delete(companyId);
}

export async function getCompanyKpis(companyId: string): Promise<CompanyKpiSummary> {
  const cached = kpiCache.get(companyId);
  if (cached && Date.now() - cached.timestamp < KPI_CACHE_TTL) {
    return cached.data;
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const activeStatuses = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] as const;

  // Fetch SLA configs (already cached 5min in dashboard-actions)
  const slaConfigs = await prisma.slaConfig.findMany({
    where: { companyId, type: "TICKET" },
    select: { priority: true, stage: true, alertBeforeMinutes: true },
  });

  const [
    openCount,
    inProgressCount,
    waitingClientCount,
    resolvedTodayCount,
    slaBreachedCount,
    pendingRefundsCount,
    ticketsWithSla,
    priorityGroups,
    channelGroupsRaw,
    avgResponseRaw,
  ] = await Promise.all([
    prisma.ticket.count({ where: { companyId, status: "OPEN" } }),
    prisma.ticket.count({ where: { companyId, status: "IN_PROGRESS" } }),
    prisma.ticket.count({ where: { companyId, status: "WAITING_CLIENT" } }),
    prisma.ticket.count({
      where: { companyId, status: "RESOLVED", updatedAt: { gte: startOfToday } },
    }),
    prisma.ticket.count({
      where: { companyId, slaBreached: true, status: { in: [...activeStatuses] } },
    }),
    prisma.refund.count({ where: { companyId, status: "AWAITING_APPROVAL" } }),
    prisma.ticket.findMany({
      where: {
        companyId,
        status: { in: [...activeStatuses] },
        slaBreached: false,
        OR: [{ slaFirstReply: { not: null } }, { slaResolution: { not: null } }],
      },
      select: { priority: true, slaFirstReply: true, slaResolution: true },
    }),
    prisma.ticket.groupBy({
      by: ["priority"],
      where: { companyId, status: { in: [...activeStatuses] } },
      _count: true,
    }),
    prisma.$queryRaw<{ channel: string; count: bigint }[]>`
      SELECT COALESCE(c."type", 'WEB') as channel, COUNT(*)::bigint as count
      FROM tickets t
      LEFT JOIN channels c ON t.channel_id = c.id
      WHERE t.company_id = ${companyId}
        AND t.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT')
      GROUP BY COALESCE(c."type", 'WEB')
    `,
    prisma.$queryRaw<{ avg_minutes: number | null }[]>`
      SELECT AVG(response_minutes) as avg_minutes
      FROM (
        SELECT EXTRACT(EPOCH FROM (
          (SELECT MIN(tm.created_at) FROM ticket_messages tm WHERE tm.ticket_id = t.id) - t.created_at
        )) / 60 as response_minutes
        FROM tickets t
        WHERE t.company_id = ${companyId}
          AND EXISTS (SELECT 1 FROM ticket_messages tm WHERE tm.ticket_id = t.id)
      ) sub
      WHERE response_minutes IS NOT NULL AND response_minutes >= 0
    `,
  ]);

  // Calculate SLA at-risk
  const alertLookup = new Map<string, number>();
  for (const config of slaConfigs) {
    alertLookup.set(`${config.priority}_${config.stage}`, config.alertBeforeMinutes);
  }

  let slaAtRiskCount = 0;
  for (const ticket of ticketsWithSla) {
    let isAtRisk = false;
    if (ticket.slaFirstReply) {
      const alertMinutes = alertLookup.get(`${ticket.priority}_first_reply`) ?? 30;
      if (getSlaStatus(ticket.slaFirstReply, alertMinutes) === "at_risk") isAtRisk = true;
    }
    if (!isAtRisk && ticket.slaResolution) {
      const alertMinutes = alertLookup.get(`${ticket.priority}_resolution`) ?? 30;
      if (getSlaStatus(ticket.slaResolution, alertMinutes) === "at_risk") isAtRisk = true;
    }
    if (isAtRisk) slaAtRiskCount++;
  }

  const result: CompanyKpiSummary = {
    openCount,
    inProgressCount,
    waitingClientCount,
    resolvedTodayCount,
    slaBreachedCount,
    slaAtRiskCount,
    pendingRefundsCount,
    avgResponseTimeMinutes: avgResponseRaw[0]?.avg_minutes
      ? Math.round(Number(avgResponseRaw[0].avg_minutes))
      : 0,
    ticketsByChannel: channelGroupsRaw.map((g) => ({ channel: g.channel, count: Number(g.count) })),
    ticketsByPriority: priorityGroups.map((g) => ({ priority: g.priority, count: g._count })),
    slaAlertBreached: slaBreachedCount,
    slaAlertAtRisk: slaAtRiskCount,
    slaCriticalCount: slaBreachedCount + slaAtRiskCount,
    refundsPendingCount: pendingRefundsCount,
  };

  kpiCache.set(companyId, { data: result, timestamp: Date.now() });
  return result;
}
```

**Step 2: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add erp/src/lib/kpi-cache.ts
git commit -m "feat: centralized KPI cache module consolidating 10+ count queries"
```

---

### Task 7: Wire KPI cache into dashboard, sidebar, and tab counts

**Files:**
- Modify: `erp/src/app/(app)/sac/tickets/dashboard-actions.ts`
- Modify: `erp/src/app/(app)/sac/tickets/actions.ts` — `getSlaAlertCounts` and `getTicketTabCounts`

**Step 1: Replace dashboard queries with KPI cache**

In `dashboard-actions.ts`, replace the 10 parallel queries with:

```typescript
import { getCompanyKpis } from "@/lib/kpi-cache";

export async function getTicketDashboard(
  companyId: string
): Promise<TicketDashboard> {
  await requireCompanyAccess(companyId);
  const kpis = await getCompanyKpis(companyId);
  return {
    openCount: kpis.openCount,
    inProgressCount: kpis.inProgressCount,
    waitingClientCount: kpis.waitingClientCount,
    resolvedTodayCount: kpis.resolvedTodayCount,
    slaBreachedCount: kpis.slaBreachedCount,
    slaAtRiskCount: kpis.slaAtRiskCount,
    pendingRefundsCount: kpis.pendingRefundsCount,
    avgResponseTimeMinutes: kpis.avgResponseTimeMinutes,
    ticketsByChannel: kpis.ticketsByChannel,
    ticketsByPriority: kpis.ticketsByPriority,
  };
}
```

Remove the local `dashboardCache`, `slaConfigCache`, and `fetchSlaConfigs` — they're now in `kpi-cache.ts`.

**Step 2: Replace getSlaAlertCounts with KPI cache**

In `actions.ts`, update `getSlaAlertCounts`:

```typescript
import { getCompanyKpis } from "@/lib/kpi-cache";

export async function getSlaAlertCounts(companyId: string) {
  await requireCompanyAccess(companyId);
  const kpis = await getCompanyKpis(companyId);
  return { breached: kpis.slaAlertBreached, atRisk: kpis.slaAlertAtRisk };
}
```

**Step 3: Replace getTicketTabCounts with KPI cache**

```typescript
export async function getTicketTabCounts(companyId: string) {
  await requireCompanyAccess(companyId);
  const kpis = await getCompanyKpis(companyId);
  return {
    slaCritical: kpis.slaCriticalCount,
    refunds: kpis.refundsPendingCount,
  };
}
```

**Step 4: Add KPI invalidation to mutation functions**

In `actions.ts`, import and call `invalidateKpiCache` after ticket status changes, refund changes, and SLA changes:

```typescript
import { invalidateKpiCache } from "@/lib/kpi-cache";
```

Add `invalidateKpiCache(companyId)` at the end of: `createTicket`, `updateTicketStatus`, `requestRefund`, `approveRefund`, `rejectRefund`, `requestCancellation`, `approveCancellation`.

**Step 5: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 6: Commit**

```bash
git add erp/src/lib/kpi-cache.ts erp/src/app/\(app\)/sac/tickets/dashboard-actions.ts erp/src/app/\(app\)/sac/tickets/actions.ts
git commit -m "perf: wire KPI cache into dashboard, sidebar, and tab counts"
```

---

## Track 4: WhatsApp Concurrent Message Processing

### Task 8: Enable concurrent message processing in Baileys provider

**Files:**
- Modify: `whatsapp-service/src/providers/baileys.provider.ts`

**Step 1: Replace serial for-loop with semaphore-limited parallel processing**

In the `messages.upsert` event handler (around line 652), replace the serial loop:

```typescript
// BEFORE (serial):
for (const msg of messages as WAMessage[]) {
  try {
    await this.handleMessage(msg, companyId);
  } catch (err) { ... }
}

// AFTER (parallel with concurrency limit):
const CONCURRENCY_LIMIT = 5;

const processBatch = async (msgs: WAMessage[]) => {
  const executing = new Set<Promise<void>>();

  for (const msg of msgs) {
    const p = this.handleMessage(msg, companyId)
      .catch((err) => {
        console.error(
          `[BaileysProvider] Error handling message for ${companyId}:`,
          err
        );
      })
      .then(() => { executing.delete(p); });
    executing.add(p);

    if (executing.size >= CONCURRENCY_LIMIT) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled(executing);
};

await processBatch(messages as WAMessage[]);
```

This processes up to 5 messages concurrently. When one finishes, the next starts.

**Step 2: Verify compilation**

Run: `cd /workspaces/app/whatsapp-service && npx tsc --noEmit` (or use the project's TypeScript check command)
Expected: 0 errors.

**Step 3: Commit**

```bash
git add whatsapp-service/src/providers/baileys.provider.ts
git commit -m "perf: concurrent WhatsApp message processing with semaphore (limit=5)"
```

---

### Task 9: Increase BullMQ worker concurrency

**Files:**
- Modify: `erp/src/lib/workers/base.ts`

**Step 1: Add concurrency parameter to `createWorker`**

```typescript
export function createWorker(
  queueName: QueueName,
  processor: (job: Job) => Promise<void>,
  concurrency = 1
): Worker {
  const worker = new Worker(
    queueName,
    async (job: Job) => {
      console.log(`[${queueName}] Processing job ${job.id}:`, job.name, job.data)
      try {
        await processor(job)
        console.log(`[${queueName}] Job ${job.id} completed`)
      } catch (error) {
        console.error(`[${queueName}] Job ${job.id} failed:`, error)
        throw error
      }
    },
    {
      connection,
      concurrency,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    }
  )
  // ... rest stays the same
```

**Step 2: Update worker instantiation with appropriate concurrency**

In `erp/src/lib/workers/index.ts`:

```typescript
const whatsappInboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_INBOUND, processWhatsAppInbound, 4)
const whatsappOutboundWorker = createWorker(QUEUE_NAMES.WHATSAPP_OUTBOUND, processWhatsAppOutbound, 3)
const emailInboundWorker = createWorker(QUEUE_NAMES.EMAIL_INBOUND, processEmailInbound, 2)
const emailOutboundWorker = createWorker(QUEUE_NAMES.EMAIL_OUTBOUND, processEmailOutbound, 2)
const aiAgentWorker = createWorker(QUEUE_NAMES.AI_AGENT, processAiAgent, 2)
// SLA check and document processing stay at 1 (sequential by nature)
```

**Step 3: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add erp/src/lib/workers/base.ts erp/src/lib/workers/index.ts
git commit -m "perf: increase BullMQ worker concurrency for WhatsApp/email/AI queues"
```

---

## Final Verification

### Task 10: Full type-check and build verification

**Step 1: Run full type check**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 2: Run build**

Run: `cd /workspaces/app/erp && npm run build`
Expected: Build succeeds.

**Step 3: Commit any remaining fixes**

If any type errors or build issues surface, fix them and commit.
