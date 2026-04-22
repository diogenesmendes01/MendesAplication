// 3 req/s, conforme documentação do Bling
const WINDOW_MS = 1000;
const MAX_REQUESTS = 3;

export class BlingRateLimiter {
  private queue: Array<() => Promise<unknown>> = [];
  private processing = false;
  private requestCount = 0;
  private windowStart = Date.now();

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      if (now - this.windowStart >= WINDOW_MS) {
        this.requestCount = 0;
        this.windowStart = now;
      }

      if (this.requestCount >= MAX_REQUESTS) {
        const wait = WINDOW_MS - (Date.now() - this.windowStart);
        await new Promise(r => setTimeout(r, wait));
        this.requestCount = 0;
        this.windowStart = Date.now();
      }

      this.requestCount++;
      const fn = this.queue.shift()!;
      await fn();
    }

    this.processing = false;
  }
}
