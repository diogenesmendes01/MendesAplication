# Logging Architecture — MendesERP

## Overview

The ERP uses **structured JSON logging** via [pino](https://github.com/pinojs/pino) with three high-level wrappers that standardize log entries across the application:

| Wrapper | Purpose | Location |
|---------|---------|----------|
| `withLogging` | Server actions (business logic) — **server-only** | `src/lib/with-logging.ts` |
| `withLibLogging` | Library/worker functions (no session/cookies) | `src/lib/with-lib-logging.ts` |
| `withApiLogging` | Next.js API route handlers | `src/lib/with-api-logging.ts` |

All wrappers automatically provide:

- **TraceId** — UUID per invocation for request correlation, propagated via `AsyncLocalStorage`
- **Sanitization** — sensitive fields (password, token, apiKey, cpf, cnpj, etc.) replaced with `[REDACTED]`
- **Truncation** — large arguments (>10KB strings, >100-item arrays, large objects) truncated before logging
- **Error classification** — structured `errorCode` field for every error
- **Duration tracking** — `durationMs` on every completed request

---

## TraceId Propagation

TraceIds are propagated between API routes and Server Actions via `AsyncLocalStorage` (`src/lib/trace-context.ts`):

1. `withApiLogging` generates a `traceId` and stores it in the `traceStore`
2. `withLogging` / `withLibLogging` read the `traceId` from the store (if available) or generate a new one
3. All logs from the same HTTP request share the same `traceId`

```
API Request → withApiLogging (generates traceId, stores in AsyncLocalStorage)
  └→ Server Action → withLogging (reads traceId from store)
     └→ All logs share the same traceId
```

---

## Usage

### Server Actions — `withLogging`

> ⚠️ **Server Actions only** — calls `getSession()` which depends on `cookies()`.
> For library/worker functions, use `withLibLogging`.

```typescript
import { withLogging } from "@/lib/with-logging";

async function _createTicket(companyId: string, data: TicketInput) {
  // business logic...
  return ticket;
}

export const createTicket = withLogging("ticket.create", _createTicket);
```

**companyId extraction**: Automatically searches all args (and 1 level deep into nested objects) for a `companyId` property. No longer limited to `args[0]`.

**Log output:**
```
action.start: ticket.create  { traceId, userId, companyId, args: [...] }
action.end:   ticket.create  { traceId, userId, companyId, durationMs, status: "success" }
action.error: ticket.create  { traceId, userId, companyId, durationMs, status: "error", errorCode, err }
```

### Library/Worker Functions — `withLibLogging`

For functions that run outside the Server Action context (BullMQ workers, utility functions, background jobs):

```typescript
import { withLibLogging } from "@/lib/with-lib-logging";

async function _processJob(data: JobData) {
  // worker logic...
}

export const processJob = withLibLogging("worker.processJob", _processJob);
```

**Log output:**
```
action.start: worker.processJob  { traceId, args: [...] }
action.end:   worker.processJob  { traceId, durationMs, status: "success" }
action.error: worker.processJob  { traceId, durationMs, status: "error", errorCode, err }
```

### API Routes — `withApiLogging`

Uses `verifyAccessToken()` from `@/lib/auth` for userId extraction (no manual JWT parsing).

```typescript
import { withApiLogging } from "@/lib/with-api-logging";

async function handler(req: NextRequest, ctx: RouteContext) {
  // route logic...
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging("auth.login", handler);

// With sampling (health endpoints):
export const GET = withApiLogging("health", handler, { sampling: 0.1 });
```

**Log output:**
```
api.start: auth.login  { traceId, method, path, userId }
api.end:   auth.login  { traceId, method, path, status, durationMs, userId }
api.error: auth.login  { traceId, method, path, durationMs, userId, errorCode, err }
```

---

## Action Name Convention

All action names use **dot notation** (`module.action`):

| ✅ Correct | ❌ Incorrect |
|-----------|-------------|
| `auth.login` | `auth/login` |
| `sac.tickets.createTicket` | `sac/tickets/createTicket` |
| `webhooks.payment` | `webhooks/payment` |

---

## Log Entry Fields

| Field | Type | Present In | Description |
|-------|------|-----------|-------------|
| `traceId` | string (UUID) | All | Unique correlation ID per request (propagated via AsyncLocalStorage) |
| `action` / `route` | string | Binding | Identifier for the wrapped function |
| `userId` | string | When available | Extracted from session (actions) or JWT via `verifyAccessToken` (API) |
| `companyId` | string | When available | Deep-extracted from args (1 level) |
| `method` | string | API only | HTTP method (GET, POST, etc.) |
| `path` | string | API only | Request URL pathname |
| `status` | "success" \| "error" | End/error logs | Outcome |
| `durationMs` | number | End/error logs | Wall-clock time in milliseconds |
| `errorCode` | string | Error logs | Structured error classification |
| `err` | object | Error logs | `{ message, stack, name }` |
| `args` | array | Start logs (actions) | Sanitized + truncated arguments |

---

## Error Codes

Every error is classified into one of these codes via `classifyError()` and `classifyErrorByStatus()`.
Both share internal `statusToErrorCode()` to avoid duplication.

| Code | When Used |
|------|-----------|
| `AUTH_FAILED` | 401, 403 (without permission keywords), "unauthorized" |
| `AUTH_TOKEN_EXPIRED` | "token expired", "jwt expired" |
| `VALIDATION_ERROR` | ZodError, ValidationError |
| `NOT_FOUND` | 404 status |
| `PERMISSION_DENIED` | 403 + message contains "permission", "access denied", "not allowed", "forbidden" |
| `EXTERNAL_SERVICE_ERROR` | ECONNREFUSED, ECONNRESET, ETIMEDOUT |
| `DATABASE_ERROR` | Prisma errors (name starts with "Prisma", code starts with "P") |
| `ENCRYPTION_ERROR` | decrypt/encrypt failures |
| `RATE_LIMIT_EXCEEDED` | 429 status |
| `INTERNAL_ERROR` | Default / unclassified |

### 403 Heuristic (PERMISSION_DENIED vs AUTH_FAILED)

When a 403 status is detected, `classifyError` inspects the error message:
- If it contains "permission", "access denied", "not allowed", or "forbidden" → `PERMISSION_DENIED`
- Otherwise → `AUTH_FAILED`

`classifyErrorByStatus()` accepts an optional `message` parameter for the same heuristic.

### Filtering in Log Aggregators

```
# Grafana/Loki LogQL
{app="mendes-erp"} | json | errorCode = "DATABASE_ERROR"

# Datadog
@errorCode:AUTH_FAILED

# grep (dev)
cat logs.json | jq 'select(.errorCode == "RATE_LIMIT_EXCEEDED")'
```

---

## Sampling

High-frequency endpoints can use sampling to reduce log volume:

```typescript
export const GET = withApiLogging("health", handler, { sampling: 0.1 });
```

- `sampling: 1.0` (default) — logs 100% of requests
- `sampling: 0.1` — logs ~10% of requests
- `sampling: 0` — logs nothing (except errors)
- **Errors ALWAYS log** regardless of sampling rate

### Currently Sampled Routes

| Route | Sampling Rate |
|-------|--------------|
| `GET /api/health` | 0.1 (10%) |
| `GET /api/health/reclameaqui` | 0.1 (10%) |

---

## Truncation

Large log arguments are automatically truncated before logging:

| Type | Threshold | Behavior |
|------|-----------|----------|
| String | >10,240 chars | Truncated + `...[truncated, original N chars]` |
| Array | >100 items | First 100 items + `...[N items, showing first 100]` |
| Object | JSON >10,240 chars | `{ _truncated: true, originalSize: N, preview: "..." }` |

Configure via `MAX_LOG_ARG_SIZE` and `MAX_LOG_ARRAY_LENGTH` (both exported) in `src/lib/logger.ts`.

---

## Retention & Rotation Policy

### Development

- **Output:** `pino-pretty` to stdout (human-readable, colorized)
- **Rotation:** None needed (stdout only)
- **Retention:** N/A

### Staging

- **Output:** JSON to stdout → captured by `journald`
- **Retention:** 7 days via journald config
- **Config:**
  ```ini
  # /etc/systemd/journald.conf.d/erp.conf
  [Journal]
  MaxRetentionSec=7d
  SystemMaxUse=2G
  ```

### Production

- **Output:** JSON to stdout → log aggregator
- **Recommended aggregators** (in order of preference):
  1. **Loki + Grafana** — open-source, cost-effective, great with structured JSON
  2. **Datadog** — full-featured APM, higher cost
  3. **Axiom** — serverless-friendly, generous free tier
- **Retention:** 30 days hot, 90 days cold (adjust per compliance needs)

### File-Based Rotation (if not using aggregator)

If stdout is redirected to files, use `logrotate`:

```
# /etc/logrotate.d/mendes-erp
/var/log/mendes-erp/*.log {
    daily
    rotate 7
    maxsize 500M
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

---

## Child Loggers

For manual logging outside wrappers, use `createChildLogger` for automatic traceId:

```typescript
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger({ companyId: "co-1", ticketId: "tk-42" });
log.info("Processing ticket");  // includes traceId + companyId + ticketId
log.error({ err }, "Failed to process");
```

---

## Sensitive Field Redaction

The following fields are automatically replaced with `[REDACTED]` in log arguments:

`password`, `token`, `secret`, `key`, `apikey`, `senha`, `cookie`, `authorization`, `accesstoken`, `refreshtoken`, `cpf`, `cnpj`, `certificatepassword`, `cert`, `pfx`

Matching is case-insensitive and applies recursively to nested objects and arrays.

---

## Worker Types

Shared worker types (e.g. `AiAgentJobData`) are defined in `src/lib/workers/types.ts` and re-exported from individual worker files for backward compatibility.
