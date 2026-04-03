# Phase 14: Outbound Message Retry - Research

**Researched:** 2026-04-03
**Domain:** Outbound message queuing and retry when BlueBubbles is offline
**Confidence:** HIGH

## Summary

Phase 14 adds a retry mechanism for outbound messages when BlueBubbles is temporarily unreachable. Currently, POST /send uses a fire-and-forget pattern: the route returns `{ messageId, status: "queued" }` immediately, then a setTimeout fires the actual BB API call. If BB is down, the send fails with a `logger.error()` and the message is permanently lost.

The existing codebase already has a well-tested `RetryQueue` class (used for inbound webhook delivery in Phase 6) that implements exponential backoff, bounded queue size, configurable max retries, and periodic processing. The outbound retry can reuse this exact pattern with a different payload type and delivery function. The key design challenge is intercepting the fire-and-forget failure in `send.ts` and routing it to an `OutboundRetryQueue` instead of just logging and dropping.

**Primary recommendation:** Create an `OutboundRetryQueue` service (modeled on `RetryQueue`) that accepts `{ phone, message, tempGuid }` entries, retries via `client.sendMessage()`, and is wired into the existing fire-and-forget flow in `send.ts`. Use the health monitor's polling as the signal that BB is back online (no need for a separate mechanism -- the retry queue's own periodic tick handles retries).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EOPS-07 | Outbound message retry when BlueBubbles is temporarily down | Full architecture below: OutboundRetryQueue service, send.ts integration, env config, bounded queue with backoff |
</phase_requirements>

## Architecture Patterns

### Current Send Flow (Problem)

```
POST /send
  -> validate + normalize + rate-limit
  -> generate tempGuid
  -> setTimeout(jitterMs, async () => {
       try { await client.sendMessage(phone, message); }
       catch { logger.error(...); }  // MESSAGE LOST HERE
     })
  -> return { messageId: tempGuid, status: "queued" }
```

### Proposed Send Flow (Solution)

```
POST /send
  -> validate + normalize + rate-limit
  -> generate tempGuid
  -> setTimeout(jitterMs, async () => {
       try { await client.sendMessage(phone, message); }
       catch (err) {
         if (isBBOfflineError(err)) {
           getOutboundRetryQueue().enqueue({ phone, message, tempGuid });
         } else {
           logger.error(...);  // Non-retryable errors still just log
         }
       }
     })
  -> return { messageId: tempGuid, status: "queued" }
```

### Pattern 1: OutboundRetryQueue (mirrors RetryQueue)

**What:** A new class `OutboundRetryQueue` that follows the exact same pattern as `RetryQueue` from Phase 6, but with a different payload type and delivery function.

**Why reuse the pattern (not the class):** The existing `RetryQueue` is typed to `WebhookPayload` and its `deliverFn` returns `Promise<boolean>`. Outbound messages need `{ phone, message, tempGuid }` and `deliverFn` calls `client.sendMessage()`. Generifying `RetryQueue<T>` would work but changes a stable, tested class. A separate `OutboundRetryQueue` is safer and clearer.

**Structure:**
```typescript
// src/services/outbound-retry-queue.ts

interface OutboundRetryEntry {
  phone: string;
  message: string;
  tempGuid: string;
  attempts: number;
  nextRetryAt: number;
  enqueuedAt: number;  // For TTL / staleness tracking
}

export class OutboundRetryQueue {
  private queue: OutboundRetryEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly maxSize: number,
    private readonly maxRetries: number,
    private readonly sendFn: (phone: string, message: string) => Promise<void>,
  ) {}

  enqueue(entry: { phone: string; message: string; tempGuid: string }): void {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
      logger.warn('Outbound retry queue full, dropping oldest entry');
    }
    this.queue.push({
      ...entry,
      attempts: 0,
      nextRetryAt: Date.now() + this.calculateDelay(0),
      enqueuedAt: Date.now(),
    });
  }

  // start(), destroy(), scheduleNext(), processDueEntries(), calculateDelay()
  // all mirror RetryQueue exactly
}
```

### Pattern 2: Error Detection for Retryable Failures

**What:** The `BlueBubblesClient.request()` method already throws `AppError` with `ERROR_CODES.BB_OFFLINE` when fetch fails (network error / timeout). This is the exact signal for "BB is down, retry later." The `sendMessage()` call in `send.ts` catches all errors generically. The fix is to inspect the caught error.

```typescript
// In the fire-and-forget catch block:
catch (err) {
  if (err instanceof AppError && err.code === ERROR_CODES.BB_OFFLINE) {
    getOutboundRetryQueue().enqueue({ phone, message: parsed.data.message, tempGuid });
    logger.warn({ tempGuid, phone }, 'BB offline, message queued for retry');
  } else {
    logger.error({ tempGuid, phone, err: err instanceof Error ? err.message : err },
      'Failed to send message to BlueBubbles');
  }
}
```

**Key distinction:** `BB_OFFLINE` (503, retryable: true) means network failure -- retry. `SEND_FAILED` (502) means BB responded with an error -- do NOT retry (the message format may be invalid, or the phone number may be wrong).

### Pattern 3: Queue Processing with BB Health Awareness

**What:** The outbound retry queue uses the same `setTimeout` chain pattern as `RetryQueue` (1-second ticks, process one entry per tick). No need to listen to health monitor events -- the queue's own periodic tick is sufficient. When BB comes back, the next `sendFn()` call succeeds and the entry is removed.

**Why not event-driven:** The health monitor polls every 60s (configurable). The retry queue already has its own 1s tick. Using health events would add coupling without improving latency -- the exponential backoff already handles the "try again soon" timing.

### Pattern 4: Singleton with Init/Shutdown

**What:** Follow the same singleton factory pattern used throughout the codebase (`getBBClient()`, `getRateLimiter()`, `initRelay()`).

```typescript
let instance: OutboundRetryQueue | null = null;

export function initOutboundRetry(): void {
  const client = getBBClient();
  instance = new OutboundRetryQueue(
    env.OUTBOUND_RETRY_QUEUE_MAX_SIZE,
    env.OUTBOUND_RETRY_MAX_ATTEMPTS,
    async (phone, message) => { await client.sendMessage(phone, message); },
  );
  instance.start();
}

export function getOutboundRetryQueue(): OutboundRetryQueue | null {
  return instance;
}

export function shutdownOutboundRetry(): void {
  instance?.destroy();
  instance = null;
}
```

### Recommended Project Structure (changes only)

```
src/
  services/
    outbound-retry-queue.ts      # NEW: OutboundRetryQueue class + singleton
    __tests__/
      outbound-retry-queue.test.ts  # NEW: mirrors retry-queue.test.ts pattern
  routes/
    send.ts                       # MODIFIED: catch block routes BB_OFFLINE to queue
  config/
    env.ts                        # MODIFIED: add OUTBOUND_RETRY_* env vars
  server.ts                       # MODIFIED: call initOutboundRetry() at startup
```

### Anti-Patterns to Avoid

- **Do NOT generify RetryQueue<T>:** The existing `RetryQueue` is stable and tested. Changing it to be generic risks breaking the inbound webhook retry. Build a parallel class instead.
- **Do NOT block the POST /send response on queue status:** The fire-and-forget pattern is a locked decision (Phase 3, D-13). The response must still return immediately with "queued".
- **Do NOT use health monitor events to trigger retries:** Adds unnecessary coupling. The queue's own tick loop is sufficient.
- **Do NOT retry SEND_FAILED errors:** These are BB application errors (bad request, etc.), not transient network failures. Only `BB_OFFLINE` is retryable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exponential backoff math | Custom delay calculation | Copy `calculateDelay()` from `RetryQueue` | Already tested, includes jitter, caps at 60s |
| Queue bounds | Unbounded array | maxSize with shift-on-overflow | Prevents OOM; pattern proven in `RetryQueue` |
| Timer lifecycle | Raw setInterval | setTimeout chain with `.unref()` | Prevents overlap, allows clean shutdown, non-blocking |

## Common Pitfalls

### Pitfall 1: Retrying Non-Retryable Errors
**What goes wrong:** Queuing messages that failed due to invalid phone number or BB application error, causing infinite retry loops.
**Why it happens:** Catching all errors generically instead of inspecting the error code.
**How to avoid:** Only enqueue on `AppError` with `code === ERROR_CODES.BB_OFFLINE`. All other errors are logged and dropped (existing behavior).
**Warning signs:** Queue fills up with entries that never succeed.

### Pitfall 2: Stale Messages After Long Outage
**What goes wrong:** Messages queued during a 12-hour outage are all delivered at once when BB comes back, potentially confusing the recipient with out-of-context messages.
**How to avoid:** Add a TTL (e.g., 1 hour) to outbound retry entries. Discard entries older than the TTL with a log. Make TTL configurable via env.
**Warning signs:** Recipient receives delayed messages that no longer make sense.

### Pitfall 3: Rate Limiter Not Applied to Retries
**What goes wrong:** When BB comes back online and the queue drains, retried messages bypass the rate limiter (jitter), causing a burst that triggers Apple spam detection.
**How to avoid:** In the `sendFn` callback, apply jitter delay before the actual send, or process entries at a throttled rate (one per tick, 1s intervals -- same as RetryQueue).
**Warning signs:** Apple flags the iMessage account after BB recovery.

### Pitfall 4: Queue Not Initialized Before Send Route Uses It
**What goes wrong:** `getOutboundRetryQueue()` returns `null` if `initOutboundRetry()` hasn't been called yet, causing a silent drop.
**How to avoid:** Call `initOutboundRetry()` in `server.ts` before Express starts listening, same as `initRelay()`. In the send route, check for null and log a warning if queue is unavailable.
**Warning signs:** Messages lost during early startup window.

### Pitfall 5: Double Send on Retry Success
**What goes wrong:** The retry succeeds but the original fire-and-forget also eventually succeeds (e.g., BB was slow, not down), resulting in a duplicate message.
**How to avoid:** The current `BlueBubblesClient.request()` uses `AbortSignal.timeout(10_000)`. If the request times out, it throws `BB_OFFLINE`. The original send will have already failed before the retry is enqueued. This is safe because the timeout is hard -- no response means no send. However, document this assumption.
**Warning signs:** Duplicate messages received by the recipient.

## Code Examples

### Error Detection in send.ts (modified catch block)
```typescript
// Source: existing send.ts lines 61-77, modified
setTimeout(async () => {
  try {
    await client.sendMessage(phone, parsed.data.message);
    logger.info({ tempGuid, phone, jitterMs }, 'Message sent to BlueBubbles');
  } catch (err) {
    if (err instanceof AppError && err.code === ERROR_CODES.BB_OFFLINE) {
      const outboundQueue = getOutboundRetryQueue();
      if (outboundQueue) {
        outboundQueue.enqueue({ phone, message: parsed.data.message, tempGuid });
        logger.warn({ tempGuid, phone }, 'BB offline — message queued for outbound retry');
      } else {
        logger.error({ tempGuid, phone }, 'BB offline and outbound retry queue unavailable');
      }
    } else {
      logger.error(
        { tempGuid, phone, err: err instanceof Error ? err.message : err },
        'Failed to send message to BlueBubbles',
      );
    }
  }
}, jitterMs);
```

### Env Schema Extension
```typescript
// Added to envSchema in env.ts
OUTBOUND_RETRY_QUEUE_MAX_SIZE: z.string().default('500').transform(Number),
OUTBOUND_RETRY_MAX_ATTEMPTS: z.string().default('10').transform(Number),
OUTBOUND_RETRY_TTL_MS: z.string().default('3600000').transform(Number), // 1 hour
```

### Server Startup Wiring
```typescript
// In server.ts, after initRelay()
import { initOutboundRetry } from './services/outbound-retry-queue.js';

// Inside listen callback:
initRelay();
initOutboundRetry();  // Before initBBEvents()
initBBEvents();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fire-and-forget, log on failure | Queue for retry on BB_OFFLINE | Phase 14 | No more lost messages during BB downtime |
| No outbound persistence | In-memory queue (file persistence if Phase 12 done) | Phase 14 | Bounded recovery window |

## Open Questions

1. **Phase 12 Dependency (Persistent Queue)**
   - What we know: Phase 14 depends on Phase 3 only per ROADMAP.md. Phase 12 adds persistent retry queue (file-based) to survive restarts.
   - What's unclear: Should Phase 14 build in-memory first and let Phase 12 upgrade it later, or should Phase 14 assume Phase 12 is done?
   - Recommendation: Build in-memory. The success criteria says "Queue state survives process restarts (uses same persistence as Phase 12 if available)" -- the "if available" wording means in-memory is acceptable now. Add a comment/hook for Phase 12 integration.

2. **Message TTL Default**
   - What we know: Messages queued for hours may be stale and confusing to recipients.
   - What's unclear: What TTL is appropriate for Tyler's use case.
   - Recommendation: Default to 1 hour (3600000ms), configurable via `OUTBOUND_RETRY_TTL_MS`. This covers typical BB restart scenarios (minutes) while preventing day-old messages from sending.

3. **Retry Throttling vs Jitter**
   - What we know: The rate limiter's jitter prevents Apple spam detection during normal sends. Retried messages bypass the rate limiter.
   - What's unclear: Whether the 1-entry-per-second retry tick rate is sufficient throttling, or if jitter should be explicitly applied to retries.
   - Recommendation: The 1-entry-per-tick (1s) processing rate from the RetryQueue pattern is conservative enough. Apple spam detection targets rapid-fire sends (sub-second). 1s spacing is safe. No need to add jitter to retries.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | vitest.config.ts (inferred from existing test patterns) |
| Quick run command | `npx vitest run src/services/__tests__/outbound-retry-queue.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EOPS-07a | BB_OFFLINE error triggers enqueue | unit | `npx vitest run src/services/__tests__/outbound-retry-queue.test.ts -t "enqueue"` | Wave 0 |
| EOPS-07b | Successful retry removes entry from queue | unit | `npx vitest run src/services/__tests__/outbound-retry-queue.test.ts -t "delivers"` | Wave 0 |
| EOPS-07c | Queue bounded at maxSize, drops oldest | unit | `npx vitest run src/services/__tests__/outbound-retry-queue.test.ts -t "drops oldest"` | Wave 0 |
| EOPS-07d | Max retries exhausted discards entry | unit | `npx vitest run src/services/__tests__/outbound-retry-queue.test.ts -t "exhausted"` | Wave 0 |
| EOPS-07e | TTL expiry discards stale entries | unit | `npx vitest run src/services/__tests__/outbound-retry-queue.test.ts -t "TTL"` | Wave 0 |
| EOPS-07f | send.ts routes BB_OFFLINE to queue | unit | `npx vitest run src/routes/__tests__/send.test.ts -t "offline"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/services/__tests__/outbound-retry-queue.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/outbound-retry-queue.test.ts` -- covers EOPS-07a through EOPS-07e
- [ ] Update `src/routes/__tests__/send.test.ts` -- covers EOPS-07f (BB_OFFLINE routing)

## Sources

### Primary (HIGH confidence)
- Direct code analysis of `src/services/retry-queue.ts` -- established retry queue pattern with exponential backoff
- Direct code analysis of `src/routes/send.ts` -- fire-and-forget pattern, catch block is the integration point
- Direct code analysis of `src/services/bluebubbles.ts` -- `BB_OFFLINE` error thrown on network failure
- Direct code analysis of `src/types/error-codes.ts` -- `BB_OFFLINE` vs `SEND_FAILED` distinction
- Direct code analysis of `src/services/health-monitor.ts` -- existing health polling (not needed for retry trigger)

### Secondary (MEDIUM confidence)
- ROADMAP.md Phase 14 success criteria -- "queue state survives restarts if Phase 12 available" wording

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure TypeScript
- Architecture: HIGH -- directly mirrors proven RetryQueue pattern from Phase 6
- Pitfalls: HIGH -- based on direct code analysis of existing error handling and timing

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable -- no external dependencies)
