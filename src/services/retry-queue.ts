import { logger } from '../middleware/logger.js';
import type { WebhookPayload } from '../types/webhook.js';

interface RetryEntry {
  payload: WebhookPayload;
  attempts: number;
  nextRetryAt: number;
}

export class RetryQueue {
  private queue: RetryEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly maxSize: number,
    private readonly maxRetries: number,
    private readonly deliverFn: (payload: WebhookPayload) => Promise<boolean>,
  ) {}

  enqueue(payload: WebhookPayload): void {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
      logger.warn('Retry queue full, dropping oldest entry');
    }
    this.queue.push({
      payload,
      attempts: 0,
      nextRetryAt: Date.now() + this.calculateDelay(0),
    });
  }

  get size(): number {
    return this.queue.length;
  }

  start(): void {
    this.scheduleNext();
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      void this.processDueEntries().then(() => {
        this.scheduleNext();
      });
    }, 1000);
    this.timer.unref();
  }

  private async processDueEntries(): Promise<void> {
    const now = Date.now();
    const dueIndex = this.queue.findIndex((e) => e.nextRetryAt <= now);
    if (dueIndex === -1) return;

    const entry = this.queue[dueIndex]!;
    const success = await this.deliverFn(entry.payload);

    if (success) {
      this.queue.splice(dueIndex, 1);
      return;
    }

    entry.attempts++;

    if (entry.attempts >= this.maxRetries) {
      this.queue.splice(dueIndex, 1);
      logger.error(
        { messageId: entry.payload.messageId, attempts: entry.attempts },
        'Retry exhausted, discarding webhook delivery',
      );
      return;
    }

    entry.nextRetryAt = Date.now() + this.calculateDelay(entry.attempts);
  }

  private calculateDelay(attempt: number): number {
    const base = Math.min(1000 * Math.pow(2, attempt), 60_000);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.round(Math.max(0, base + jitter));
  }
}
