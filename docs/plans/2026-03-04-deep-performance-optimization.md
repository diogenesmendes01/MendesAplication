# Deep Performance Optimization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce page load times from 8-20s to 2-5s by eliminating unnecessary queries, adding DB indexes, caching data that rarely changes, and optimizing Next.js config.

**Architecture:** Fix 3 categories: (1) eliminate redundant queries and polling; (2) add database indexes for common WHERE clauses; (3) optimize Next.js build config.

**Tech Stack:** Next.js 14, Prisma 6, TypeScript, React, PostgreSQL

---

### Task 1: Add database indexes to Prisma schema

**Files:**
- Modify: `erp/prisma/schema.prisma`

**Step 1: Add indexes to Ticket model**

After the `@@map("tickets")` line (line 460), add indexes just before it:

```prisma
  @@index([companyId, status])
  @@index([companyId, slaBreached])
  @@index([companyId, clientId])
  @@index([companyId, assigneeId])
  @@map("tickets")
```

**Step 2: Add indexes to TicketMessage model**

Before `@@map("ticket_messages")` (line 484):

```prisma
  @@index([ticketId, createdAt])
  @@unique([externalId, channel])
  @@map("ticket_messages")
```

**Step 3: Add indexes to AccountReceivable model**

Find the AccountReceivable model `@@map("accounts_receivable")` and add before it:

```prisma
  @@index([companyId, status, dueDate])
  @@map("accounts_receivable")
```

**Step 4: Add indexes to AccountPayable model**

Find the AccountPayable model `@@map("accounts_payable")` and add before it:

```prisma
  @@index([companyId, status, dueDate])
  @@map("accounts_payable")
```

**Step 5: Add index to Refund model**

Find the Refund model `@@map("refunds")` and add before it:

```prisma
  @@index([companyId, status])
  @@index([ticketId])
  @@map("refunds")
```

**Step 6: Push schema to database**

Run: `cd /workspaces/app/erp && npx prisma db push`
Expected: Schema synced without errors.

**Step 7: Commit**

```bash
git add erp/prisma/schema.prisma
git commit -m "perf: add database indexes for common query patterns"
```

---

### Task 2: Cache CompanyContext — stop re-fetching on every navigation

**Files:**
- Modify: `erp/src/contexts/company-context.tsx`

**Step 1: Add sessionStorage cache to avoid refetching companies on every mount**

The CompanyProvider currently calls `getUserCompanies()` on every mount (every navigation). Companies almost never change during a session. Cache the result in sessionStorage and only refetch if stale (>5 minutes).

Replace the entire `useEffect` that calls `getUserCompanies()` (lines 31-53) with:

```typescript
  // Load companies — cached in sessionStorage to avoid refetching on every navigation
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Try sessionStorage cache first
      const CACHE_KEY = "mendes-erp-companies-cache";
      const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL && Array.isArray(data) && data.length > 0) {
            if (cancelled) return;
            setCompanies(data);
            const stored = localStorage.getItem(STORAGE_KEY);
            const validStored = stored && data.some((c: UserCompany) => c.id === stored);
            setSelectedCompanyIdState(validStored ? stored : data[0]?.id ?? null);
            setLoading(false);
            return;
          }
        }
      } catch {
        // ignore cache read errors
      }

      try {
        const data = await getUserCompanies();
        if (cancelled) return;
        setCompanies(data);

        // Cache result
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
        } catch {
          // ignore cache write errors
        }

        const stored = localStorage.getItem(STORAGE_KEY);
        const validStored = stored && data.some((c) => c.id === stored);
        setSelectedCompanyIdState(validStored ? stored : data[0]?.id ?? null);
      } catch {
        // user not authenticated or error — leave empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);
```

**Step 2: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit --pretty 2>&1 | grep "company-context" | head -5`
Expected: No errors.

**Step 3: Commit**

```bash
git add erp/src/contexts/company-context.tsx
git commit -m "perf: cache companies in sessionStorage — avoid refetch on navigation"
```

---

### Task 3: Eliminate timeline 5s polling — use manual refresh + WhatsApp-only auto-refresh

**Files:**
- Modify: `erp/src/app/(app)/sac/tickets/[id]/ticket-timeline.tsx`

**Step 1: Find the component props interface and add `channelType`**

Find the component's props interface (look for `interface` near the top of the component section around line 504) and add `channelType?: string | null` to it. The parent page already has this data from `ticket.channelType`.

**Step 2: Replace the 5-second polling useEffect**

Replace the auto-refresh useEffect (lines 576-589):

```typescript
  // Auto-refresh timeline — only for WhatsApp tickets (real-time needed)
  // Email and web tickets use manual refresh
  useEffect(() => {
    if (!ticketId || !companyId) return;
    if (channelType !== "WHATSAPP") return;

    const interval = setInterval(() => {
      listTimelineEvents(ticketId, companyId)
        .then((data) => {
          setEvents((prev) => {
            if (data.length !== prev.length) return data;
            return prev;
          });
        })
        .catch(() => {});
    }, 10_000); // 10 seconds for WhatsApp instead of 5

    return () => clearInterval(interval);
  }, [ticketId, companyId, channelType]);
```

**Step 3: Add a manual refresh function**

After the loadEvents useCallback, add an exposed refresh function. Find where `loadEvents` is defined and after its useEffect add:

```typescript
  // Manual refresh — exposed via button in the UI
  const [refreshing, setRefreshing] = useState(false);
  async function handleManualRefresh() {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  }
```

**Step 4: Add refresh button to the timeline header**

Find the timeline header area (look for a section title or heading like "Histórico" or the tabs area). Add a small refresh button next to it. Find the appropriate spot in the JSX — likely near the top of the timeline container, near any heading or tab bar — and add:

```tsx
<Button
  variant="ghost"
  size="icon"
  onClick={handleManualRefresh}
  disabled={refreshing}
  title="Atualizar timeline"
  className="h-7 w-7"
>
  <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
</Button>
```

Make sure to import `RefreshCw` from `lucide-react` at the top of the file.

**Step 5: Lazy-load email and WhatsApp recipients — only when user clicks the tab**

Replace the two useEffects that load recipients on mount (lines 596-621). Instead of loading on mount, load when the user clicks the email or WhatsApp tab. Find the state variable that tracks which tab is active (likely `activeTab` or similar). Then replace:

```typescript
  // Load email recipients — only when Email tab is first opened
  const [recipientsLoaded, setRecipientsLoaded] = useState(false);
  useEffect(() => {
    if (activeTab !== "email" || recipientsLoaded) return;
    if (!ticketId || !companyId) return;
    getEmailRecipients(ticketId, companyId)
      .then((r) => {
        setRecipients(r);
        if (r.length > 0 && !emailTo) {
          setEmailTo(r[0].email);
        }
        setRecipientsLoaded(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ticketId, companyId, recipientsLoaded]);

  // Load WhatsApp recipients — only when WhatsApp tab is first opened
  const [waRecipientsLoaded, setWaRecipientsLoaded] = useState(false);
  useEffect(() => {
    if (activeTab !== "whatsapp" || waRecipientsLoaded) return;
    if (!ticketId || !companyId) return;
    getWhatsAppRecipients(ticketId, companyId)
      .then((r) => {
        setWaRecipients(r);
        if (r.length > 0 && !waTo) {
          setWaTo(r[0].phone);
        }
        setWaRecipientsLoaded(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ticketId, companyId, waRecipientsLoaded]);
```

**Step 6: Update parent page to pass channelType prop**

In `erp/src/app/(app)/sac/tickets/[id]/page.tsx`, find where `<TicketTimeline` is rendered and add the `channelType` prop:

```tsx
<TicketTimeline
  ticketId={ticketId}
  companyId={selectedCompanyId}
  channelType={ticket?.channelType ?? null}
  // ... other existing props
/>
```

**Step 7: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit --pretty 2>&1 | grep -E "ticket-timeline|tickets/\[id\]" | head -10`
Expected: No errors.

**Step 8: Commit**

```bash
git add erp/src/app/\(app\)/sac/tickets/\[id\]/ticket-timeline.tsx erp/src/app/\(app\)/sac/tickets/\[id\]/page.tsx
git commit -m "perf: replace 5s timeline polling with WhatsApp-only 10s + manual refresh"
```

---

### Task 4: Parallelize ticket detail page queries

**Files:**
- Modify: `erp/src/app/(app)/sac/tickets/[id]/page.tsx`

**Step 1: Replace sequential queries with Promise.all in loadTicket**

Replace lines 325-351 (the `loadTicket` callback):

```typescript
  const loadTicket = useCallback(async () => {
    if (!selectedCompanyId || !ticketId) return;
    setLoading(true);
    try {
      // Load ticket first (others depend on client.id)
      const data = await getTicketById(ticketId, selectedCompanyId);
      setTicket(data);
      setTags(data.tags);

      // Run all secondary queries in parallel
      await Promise.all([
        getClientFinancialSummary(data.client.id, selectedCompanyId)
          .then(setFinancial)
          .catch(() => {}),
        getTicketRefunds(ticketId, selectedCompanyId)
          .then(setRefunds)
          .catch(() => {}),
        getCancellationInfo(ticketId, selectedCompanyId)
          .then(setCancellation)
          .catch(() => {}),
        getAiConfigEnabled(selectedCompanyId)
          .then(setAiConfigEnabled)
          .catch(() => {}),
      ]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar ticket"
      );
    } finally {
      setLoading(false);
    }
  }, [ticketId, selectedCompanyId]);
```

**Step 2: Merge the users/role useEffect into the same parallel block**

Replace the separate useEffect for users (lines 358-362):

```typescript
  useEffect(() => {
    if (!selectedCompanyId) return;
    // Run both in parallel
    Promise.all([
      listUsersForAssign(selectedCompanyId).then(setUsers).catch(() => {}),
      getUserRole(selectedCompanyId).then(setUserRole).catch(() => {}),
    ]);
  }, [selectedCompanyId]);
```

**Step 3: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit --pretty 2>&1 | grep "tickets/\[id\]/page" | head -5`
Expected: No errors.

**Step 4: Commit**

```bash
git add erp/src/app/\(app\)/sac/tickets/\[id\]/page.tsx
git commit -m "perf: parallelize ticket detail queries with Promise.all"
```

---

### Task 5: Cache SLA configs — fetched on every ticket list and dashboard load

**Files:**
- Modify: `erp/src/app/(app)/sac/tickets/actions.ts`
- Modify: `erp/src/app/(app)/sac/tickets/dashboard-actions.ts`

**Step 1: Create an in-memory SLA config cache**

SLA configs rarely change but are fetched on every ticket list load AND every dashboard load. Add a simple in-memory cache at the top of `actions.ts` (after the imports):

```typescript
// In-memory SLA config cache — configs change rarely, fetched frequently
const slaConfigCache = new Map<string, { data: { priority: string; stage: string; alertBeforeMinutes: number }[]; timestamp: number }>();
const SLA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchSlaConfigs(companyId: string) {
  const cached = slaConfigCache.get(companyId);
  if (cached && Date.now() - cached.timestamp < SLA_CACHE_TTL) {
    return cached.data;
  }
  const configs = await prisma.slaConfig.findMany({
    where: { companyId, type: "TICKET" },
    select: { priority: true, stage: true, alertBeforeMinutes: true },
  });
  slaConfigCache.set(companyId, { data: configs, timestamp: Date.now() });
  return configs;
}
```

**Step 2: Replace the SLA config query in `listTickets`**

In `listTickets`, replace lines 141-144:

```typescript
  // Fetch SLA alert configs for at-risk calculation (cached)
  const slaConfigs = await fetchSlaConfigs(params.companyId);
```

Remove the old `prisma.slaConfig.findMany` call.

**Step 3: Replace the SLA config query in `dashboard-actions.ts`**

In `getTicketDashboard`, the slaConfigs query is inside Promise.all (line 95-98). Move it out of Promise.all and use a shared cached version. Add the same `fetchSlaConfigs` function at the top of `dashboard-actions.ts` (or import from a shared location), then replace the `slaConfigs` entry in the Promise.all with `Promise.resolve([])` and add before the Promise.all:

```typescript
  // SLA configs cached separately — rarely change
  const slaConfigs = await fetchSlaConfigs(companyId);
```

Then remove the `slaConfigs` from the Promise.all destructuring and its corresponding query.

**Step 4: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit --pretty 2>&1 | grep -E "actions|dashboard-actions" | head -10`
Expected: No errors.

**Step 5: Commit**

```bash
git add erp/src/app/\(app\)/sac/tickets/actions.ts erp/src/app/\(app\)/sac/tickets/dashboard-actions.ts
git commit -m "perf: cache SLA configs in-memory — avoid refetch every list/dashboard load"
```

---

### Task 6: Optimize Next.js config

**Files:**
- Modify: `erp/next.config.mjs`

**Step 1: Add optimizePackageImports and other performance settings**

Replace the entire file:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Tree-shake named imports from these heavy packages
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "@radix-ui/react-icons",
    ],
  },
  // Disable X-Powered-By header
  poweredByHeader: false,
};

export default nextConfig;
```

**Step 2: Commit**

```bash
git add erp/next.config.mjs
git commit -m "perf: optimize Next.js config — tree-shake heavy packages"
```

---

### Task 7: Make audit log async on login

**Files:**
- Modify: `erp/src/app/api/auth/login/route.ts`

**Step 1: Find the audit log call in the login route and make it non-blocking**

Find the `logAuditEvent` call after successful login. Change it from `await logAuditEvent(...)` to fire-and-forget:

```typescript
  // Fire and forget — don't block login response
  logAuditEvent({
    userId: user.id,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    companyId: user.id, // or whatever value is used
  }).catch(console.error);
```

Remove the `await` so the login response is sent immediately without waiting for the audit log write.

**Step 2: Verify compilation**

Run: `cd /workspaces/app/erp && npx tsc --noEmit --pretty 2>&1 | grep "auth/login" | head -5`
Expected: No errors.

**Step 3: Commit**

```bash
git add erp/src/app/api/auth/login/route.ts
git commit -m "perf: async audit log on login — don't block response"
```

---

### Task 8: Final type-check and build verification

**Step 1: Run full type check**

Run: `cd /workspaces/app/erp && npx tsc --noEmit`
Expected: 0 errors.

**Step 2: Run build**

Run: `cd /workspaces/app/erp && npm run build`
Expected: Build succeeds.

**Step 3: Push schema changes**

Run: `cd /workspaces/app/erp && npx prisma db push`
Expected: Schema synced.

**Step 4: Start dev server and verify pages load faster**

Run: `cd /workspaces/app/erp && npm run dev`
Expected: Pages load noticeably faster.
