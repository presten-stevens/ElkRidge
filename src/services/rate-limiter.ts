import { env } from '../config/env.js';

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private sendCount: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerHour: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.sendCount = 0;
  }

  consume(): boolean {
    this.refill();
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedHours = (now - this.lastRefill) / (1000 * 60 * 60);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedHours * this.refillPerHour);
    this.lastRefill = now;
  }

  getJitterMs(): number {
    this.sendCount += 1;
    const longPauseInterval = 3 + Math.floor(Math.random() * 3);
    if (this.sendCount % longPauseInterval === 0) {
      return 30_000 + Math.random() * 60_000;
    }
    return 2_000 + Math.random() * 6_000;
  }

  get remainingTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

let instance: TokenBucket | null = null;

export function getRateLimiter(): TokenBucket {
  if (!instance) {
    instance = new TokenBucket(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_HOUR);
  }
  return instance;
}
