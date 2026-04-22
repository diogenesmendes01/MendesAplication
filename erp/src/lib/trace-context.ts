// ─── Trace Context (AsyncLocalStorage) ───────────────────────────────────────
// Propagates traceId between API routes and Server Actions within the same
// request lifecycle. See: docs/logging.md
//
// Usage:
//   - withApiLogging sets traceId via traceStore.run()
//   - withLogging reads from traceStore.getStore() (falls back to new UUID)

import { AsyncLocalStorage } from "async_hooks";

export interface TraceStore {
  traceId: string;
}

export const traceStore = new AsyncLocalStorage<TraceStore>();
