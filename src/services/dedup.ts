import { logger } from '../middleware/logger.js';

export class DedupBuffer {
  private seen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;

  constructor(private readonly ttlMs: number = 60_000) {
    this.timer = setInterval(() => this.cleanup(), 30_000);
    this.timer.unref();
  }

  isDuplicate(guid: string): boolean {
    const now = Date.now();
    const seenAt = this.seen.get(guid);

    if (seenAt !== undefined && now - seenAt < this.ttlMs) {
      logger.debug({ guid }, 'Duplicate event skipped');
      return true;
    }

    this.seen.set(guid, now);
    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [guid, timestamp] of this.seen) {
      if (now - timestamp >= this.ttlMs) {
        this.seen.delete(guid);
      }
    }
  }

  destroy(): void {
    clearInterval(this.timer);
    this.seen.clear();
  }
}
