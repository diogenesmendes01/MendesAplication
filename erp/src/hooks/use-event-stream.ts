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
          // eslint-disable-next-line no-console
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
