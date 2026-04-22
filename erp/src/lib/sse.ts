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
    listeners.forEach((listener) => {
      listener(event, json);
    });
  }
}

export const sseBus = new SSEBus();
