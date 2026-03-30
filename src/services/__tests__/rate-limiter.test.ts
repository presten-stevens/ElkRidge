import { describe, it, expect, vi, afterEach } from 'vitest';
import { TokenBucket } from '../rate-limiter.js';

describe('TokenBucket', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with full capacity', () => {
    const bucket = new TokenBucket(10, 4);
    expect(bucket.remainingTokens).toBe(10);
  });

  it('consume decrements tokens', () => {
    const bucket = new TokenBucket(10, 4);
    const result = bucket.consume();
    expect(result).toBe(true);
    expect(bucket.remainingTokens).toBe(9);
  });

  it('rejects when exhausted', () => {
    const bucket = new TokenBucket(10, 4);
    for (let i = 0; i < 10; i++) {
      expect(bucket.consume()).toBe(true);
    }
    expect(bucket.consume()).toBe(false);
  });

  it('refills over time', () => {
    const bucket = new TokenBucket(1, 4);
    expect(bucket.consume()).toBe(true);
    expect(bucket.consume()).toBe(false);

    // Advance time by 1 hour
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60 * 60 * 1000);

    // Should have refilled (4 tokens/hr, capped at capacity 1)
    expect(bucket.consume()).toBe(true);
  });

  it('getJitterMs returns value in 2000-8000ms range for normal sends', () => {
    const bucket = new TokenBucket(10, 4);
    const jitter = bucket.getJitterMs();
    expect(jitter).toBeGreaterThanOrEqual(2000);
    expect(jitter).toBeLessThan(8000);
  });

  it('getJitterMs returns long pause range occasionally', () => {
    // Mock Math.random to return 0, which makes longPauseInterval = 3
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const bucket = new TokenBucket(10, 4);

    // First two calls are normal (sendCount 1, 2 -- neither divisible by 3)
    const jitter1 = bucket.getJitterMs();
    expect(jitter1).toBeGreaterThanOrEqual(2000);
    expect(jitter1).toBeLessThan(8000);

    const jitter2 = bucket.getJitterMs();
    expect(jitter2).toBeGreaterThanOrEqual(2000);
    expect(jitter2).toBeLessThan(8000);

    // Third call: sendCount=3, 3 % 3 === 0 -> long pause
    const jitter3 = bucket.getJitterMs();
    expect(jitter3).toBeGreaterThanOrEqual(30000);
    expect(jitter3).toBeLessThanOrEqual(90000);
  });
});
