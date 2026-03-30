# Logging Architecture — MendesERP

## Overview

The ERP uses **structured JSON logging** via [pino](https://github.com/pinojs/pino) with two high-level wrappers that standardize log entries across the application:

| Wrapper | Purpose | Location |
|---------|---------|----------|
| `withLogging` | Server actions (business logic) | `src/lib/with-logging.ts` |
| `withApiLogging` | Next.js API route handlers | `src/lib/with-api-logging.ts` |

Both wrappers automatically provide:

- **TraceId** — unique UUID per invocation for request correlation
- **Sanitization** — sensitive fields (password, token, apiKey, cpf, cnpj, etc.) replaced with `[REDACTED]`
- **Truncation** — large arguments (>10KB strings, >100-item arrays, large objects) truncated before logging
- **Error classification** — structured `errorCode` field for every error
- **Duration tracking** — `durationMs` on every completed request

---

## Usage

### Server Actions — `withLogging`

```typescript
import { withLogging } from "@/lib/with-logging";

async function _createTicket(companyId: string, data: TicketInput) {
  // business logic...
  return ticket;
}

export const createTicket = withLogging("ticket.create", _createTicket);
```

**Log output:**
```
action.start: ticket.create  { traceId, userId, companyId, args: [...] }
action.end:   ticket.create  { traceId, userId, companyId, durationMs, status: "success" }
action.error: ticket.create  { traceId, userId, companyId, durationMs, status: "error", errorCode, err }
```

### API Routes — `withApiLogging`

```typescript
import { withApiLogging } from "@/lib/with-api-logging";

async function handler(req: NextRequest, ctx: any) {
  // route logic...
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging("auth/login", handler);

// With sampling (health endpoints):
export const GET = withApiLogging("health", handler, { sampling: 0.1 });
```

**Log output:**
```
api.start: auth/login  { traceId, method, path, userId }
api.end:   auth/login  { traceId, method, path, status, durationMs, userId }
api.error: auth/login  { traceId, method, path, durationMs, userId, errorCode, err }
```

---

## Log Entry Fields

| Field | Type | Present In | Description |
|-------|------|-----------|-------------|
| `traceId` | string (UUID) | All | Unique correlation ID per request |
| `action` / `route` | string | Binding | Identifier for the wrapped function |
| `userId` | string | When available | Extracted from session or JWT |
| `companyId` | string | When available | Extracted from first argument |
| `method` | string | API only | HTTP method (GET, POST, etc.) |
| `path` | string | API only | Request URL pathname |
| `status` | "success" \| "error" | End/error logs | Outcome |
| `durationMs` | number | End/error logs | Wall-clock time in milliseconds |
| `errorCode` | string | Error logs | Structured error classification |
| `err` | object | Error logs | `{ message, stack, name }` |
| `args` | array | Start logs (actions) | Sanitized + truncated arguments |

---

## Error Codes

Every error is classified into one of these codes via `classifyError()`:

| Code | When Used |
|------|-----------|
| `AUTH_FAILED` | 401/403, "unauthorized", "forbidden" |
| `AUTH_TOKEN_EXPIRED` | "token expired", "jwt expired" |
| `VALIDATION_ERROR` | ZodError, ValidationError |
| `NOT_FOUND` | 404 status |
| `PERMISSION_DENIED` | Access control rejections |
| `EXTERNAL_SERVICE_ERROR` | ECONNREFUSED, ECONNRESET, ETIMEDOUT |
| `DATABASE_ERROR` | Prisma errors (name starts with "Prisma", code starts with "P") |
| `ENCRYPTION_ERROR` | decrypt/encrypt failures |
| `RATE_LIMIT_EXCEEDED` | 429 status |
| `INTERNAL_ERROR` | Default / unclassified |

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
| Object | JSON >10,240 chars | JSON stringified + truncated |

Configure via `MAX_LOG_ARG_SIZE` in `src/lib/logger.ts`.

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
