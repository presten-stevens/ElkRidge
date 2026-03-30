import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DedupBuffer } from '../dedup.js';

describe('DedupBuffer', () => {
  let buffer: DedupBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    buffer = new DedupBuffer(60_000);
  });

  afterEach(() => {
    buffer.destroy();
    vi.useRealTimers();
  });

  it('returns false on first call for a GUID', () => {
    expect(buffer.isDuplicate('guid-1')).toBe(false);
  });

  it('returns true on second call within TTL', () => {
    buffer.isDuplicate('guid-1');
    expect(buffer.isDuplicate('guid-1')).toBe(true);
  });

  it('returns false after TTL expires', () => {
    buffer.isDuplicate('guid-1');
    vi.advanceTimersByTime(61_000);
    expect(buffer.isDuplicate('guid-1')).toBe(false);
  });

  it('returns false for a different GUID', () => {
    buffer.isDuplicate('guid-1');
    expect(buffer.isDuplicate('guid-2')).toBe(false);
  });

  it('destroy clears interval and map', () => {
    buffer.isDuplicate('guid-1');
    buffer.destroy();
    // After destroy, the buffer should be empty — isDuplicate should return false
    // We create a new buffer to test since destroy clears state
    expect(buffer.isDuplicate('guid-1')).toBe(false);
  });

  it('cleanup removes only expired entries', () => {
    buffer.isDuplicate('guid-1');
    vi.advanceTimersByTime(30_000);
    buffer.isDuplicate('guid-2');
    vi.advanceTimersByTime(31_000); // guid-1 is now 61s old, guid-2 is 31s old

    // guid-1 should have been cleaned up by the interval (runs every 30s)
    // guid-2 should still be a duplicate
    expect(buffer.isDuplicate('guid-1')).toBe(false);
    expect(buffer.isDuplicate('guid-2')).toBe(true);
  });
});
