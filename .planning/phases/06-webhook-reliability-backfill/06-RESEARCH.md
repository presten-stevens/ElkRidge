# Phase 6: Webhook Reliability & Backfill - Research

**Researched:** 2026-03-30
**Domain:** Retry queues, exponential backoff, message backfill
**Confidence:** HIGH

## Summary

Phase 6 adds two reliability features to the existing Phase 5 webhook pipeline: (1) a retry queue with exponential backoff for failed CRM webhook deliveries, and (2) message backfill on startup/reconnect using BlueBubbles' message query API with the `after` timestamp parameter. Both features build directly on existing code -- `relayToCRM()` in webhook-relay.ts gets retry integration, and `readSyncState()` provides the `last_synced_at` baseline for backfill queries.

The implementation is straightforward because all the building blocks exist: the BB client can query messages globally via `GET /api/v1/message?after={timestamp}`, the dedup buffer prevents double-delivery during backfill, and the sync state file already persists `last_synced_at`. The retry queue is pure in-memory with no external dependencies. The main complexity is ensuring the retry processing loop integrates cleanly with the existing relay path and that backfill runs asynchronously without blocking startup.

**Primary recommendation:** Build the retry queue as a standalone service with a setTimeout chain (not setInterval) for more predictable timing, and the backfill as an async function that pages through BB messages and funnels each through the existing dedup-relay-sync pipeline.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** In-memory retry queue in `src/services/retry-queue.ts`. Each entry: `{ payload, attempts, nextRetryAt }`.
- **D-02:** Exponential backoff: initial delay 1s, multiplied by 2 each retry, capped at 60s max delay. Jitter: +/- 20% randomization on each delay.
- **D-03:** Max 5 retries per message. After 5 failures -> log error and discard (don't block the queue).
- **D-04:** Queue size capped at configurable max (default 1000, via `RETRY_QUEUE_MAX_SIZE` env var). When full, oldest entries are dropped with a warning log.
- **D-05:** Processing loop: setInterval (or setTimeout chain) checks queue every 1 second, processes entries whose `nextRetryAt` has passed. Use `.unref()` for graceful shutdown.
- **D-06:** Integrate with existing `relayToCRM` from Phase 5 -- on failure, enqueue for retry instead of logging and moving on.
- **D-07:** Trigger backfill on: (1) server startup and (2) Socket.IO reconnect event. Both read `last_synced_at` from `data/last-synced.json` via existing `readSyncState()`.
- **D-08:** Query BB for messages since `last_synced_at` using existing `BlueBubblesClient.getMessages()` or a new `getMessagesSince(timestamp)` method. Paginate through all results.
- **D-09:** For each backfilled message: run through same dedup -> relay -> sync pipeline as live messages. This ensures no double-delivery if some were already processed.
- **D-10:** If `last_synced_at` is null (first run), skip backfill -- no baseline to compare against.
- **D-11:** Backfill runs asynchronously -- doesn't block server startup or Socket.IO reconnection.
- **D-12:** New file: `src/services/retry-queue.ts` for the retry logic.
- **D-13:** New file: `src/services/backfill.ts` for the backfill-on-reconnect logic.
- **D-14:** Modify `src/services/webhook-relay.ts` -- add retry queue integration (on failure, enqueue instead of just logging).
- **D-15:** Modify `src/services/bb-events.ts` -- call backfill on Socket.IO reconnect.
- **D-16:** Modify `src/server.ts` -- call backfill on startup after initBBEvents.

### Claude's Discretion
- Whether to use setTimeout chain or setInterval for retry processing
- Exact BB API endpoint for querying messages by timestamp
- Whether backfill needs its own BB client method or reuses existing ones
- Test mocking strategy for retry timing

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOOK-03 | Webhook retry with exponential backoff on failed deliveries | Retry queue design (D-01 through D-06), exponential backoff pattern with jitter, bounded queue with oldest-drop eviction |
| HOOK-05 | Backfill on reconnect -- query BlueBubbles for messages since last_synced_at, fire to webhook | BB API `GET /api/v1/message?after={timestamp}` endpoint confirmed, backfill design (D-07 through D-11), dedup integration for safe re-processing |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `setTimeout` | N/A | Retry processing loop | No external dependency needed for a simple timer chain |
| Node.js built-in `fetch` | N/A | Webhook delivery (already used in relayToCRM) | Already established in Phase 5 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.2 | Unit testing retry queue and backfill | All new service files need tests |
| zod | 4.3.6 | Env var validation for RETRY_QUEUE_MAX_SIZE | Extend existing envSchema |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory retry queue | p-retry / async-retry NPM packages | Overkill -- our retry queue needs custom eviction and bounded size; a 60-line class is simpler than adapting a library |
| setTimeout chain | setInterval | setTimeout chain is recommended -- avoids overlap if processing takes longer than interval, cleaner shutdown |
| In-memory queue | Redis/BullMQ | Massive overkill for a single-instance service with backfill-on-restart as safety net |

**Installation:**
No new packages needed. All features use Node.js built-ins and existing project dependencies.

## Architecture Patterns

### Recommended Project Structure
```
src/
  services/
    retry-queue.ts        # NEW: RetryQueue class
    backfill.ts           # NEW: runBackfill() function
    webhook-relay.ts      # MODIFY: return success/failure, enqueue on failure
    bb-events.ts          # MODIFY: add reconnect backfill trigger
    bluebubbles.ts        # MODIFY: add getMessagesSince() method
    sync-state.ts         # UNCHANGED: already provides readSyncState/writeSyncState
    dedup.ts              # UNCHANGED: used by backfill for dedup
  config/
    env.ts                # MODIFY: add RETRY_QUEUE_MAX_SIZE
  server.ts               # MODIFY: call backfill on startup
  services/__tests__/
    retry-queue.test.ts   # NEW
    backfill.test.ts      # NEW
    webhook-relay.test.ts # MODIFY: test retry integration
    bb-events.test.ts     # MODIFY: test reconnect backfill
```

### Pattern 1: Retry Queue with setTimeout Chain
**What:** A class that holds an array of retry entries, processes due entries on a recurring setTimeout, and self-schedules the next tick.
**When to use:** When you need bounded, in-memory retry with backoff and don't want external dependencies.
**Example:**
```typescript
// RetryQueue class sketch
interface RetryEntry {
  payload: WebhookPayload;
  attempts: number;
  nextRetryAt: number;
}

class RetryQueue {
  private queue: RetryEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly maxSize: number,
    private readonly maxRetries: number,
    private readonly deliverFn: (payload: WebhookPayload) => Promise<boolean>,
  ) {}

  enqueue(payload: WebhookPayload): void {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); // Drop oldest
      logger.warn('Retry queue full, dropping oldest entry');
    }
    this.queue.push({ payload, attempts: 0, nextRetryAt: Date.now() + this.calculateDelay(0) });
  }

  private calculateDelay(attempt: number): number {
    const base = Math.min(1000 * Math.pow(2, attempt), 60_000);
    const jitter = base * 0.2 * (Math.random() * 2 - 1); // +/- 20%
    return Math.max(0, base + jitter);
  }

  start(): void { this.tick(); }

  private tick(): void {
    const now = Date.now();
    const due = this.queue.filter(e => e.nextRetryAt <= now);
    // Process due entries, re-enqueue failures, remove successes/exhausted
    this.timer = setTimeout(() => this.tick(), 1000);
    this.timer.unref();
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }
}
```

### Pattern 2: Backfill as Async Pipeline
**What:** An async function that reads `last_synced_at`, queries BB for messages since that timestamp, and processes each through the existing dedup-relay-sync pipeline.
**When to use:** On startup and Socket.IO reconnect.
**Example:**
```typescript
// backfill.ts sketch
export async function runBackfill(
  client: BlueBubblesClient,
  dedup: DedupBuffer,
  relay: (payload: WebhookPayload) => Promise<void>,
): Promise<void> {
  const lastSynced = await readSyncState();
  if (!lastSynced) {
    logger.info('No last_synced_at found, skipping backfill');
    return;
  }

  const afterMs = new Date(lastSynced).getTime();
  let offset = 0;
  const limit = 100;

  while (true) {
    const messages = await client.getMessagesSince(afterMs, offset, limit);
    if (messages.length === 0) break;

    for (const msg of messages) {
      if (msg.isFromMe) continue;
      if (dedup.isDuplicate(msg.guid)) continue;
      const payload = mapInboundMessage(msg);
      await relay(payload);
      await writeSyncState(new Date(msg.dateCreated).toISOString());
    }

    offset += messages.length;
    if (messages.length < limit) break;
  }
}
```

### Pattern 3: relayToCRM Returns Success/Failure
**What:** Modify `relayToCRM()` to return a boolean indicating delivery success, so callers can decide whether to enqueue for retry.
**When to use:** The current implementation logs errors but returns void. Phase 6 needs the caller to know if delivery failed.
**Example:**
```typescript
// Modified relayToCRM signature
export async function relayToCRM(payload: WebhookPayload): Promise<boolean> {
  // ... existing fetch logic ...
  // Return true on success, false on failure (instead of just logging)
}
```

### Anti-Patterns to Avoid
- **Retrying inside relayToCRM itself:** Don't put retry logic in the relay function. The retry queue is a separate concern that manages timing and bounds. relayToCRM should do one attempt and report success/failure.
- **Blocking startup with backfill:** Backfill must be fire-and-forget. If BB is slow or has thousands of messages, startup should not wait.
- **Retry queue processing multiple entries simultaneously:** Process one at a time to avoid hammering a potentially-recovering CRM endpoint. The 1-second tick naturally throttles this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Jitter calculation | Custom random with edge cases | Standard formula: `base * (1 + 0.2 * (Math.random() * 2 - 1))` | Off-by-one jitter bugs are common; this formula is well-tested |
| Timer cleanup on shutdown | Manual tracking of all timers | `.unref()` on setTimeout + explicit `destroy()` method | Matches existing DedupBuffer pattern in dedup.ts |

**Key insight:** The retry queue and backfill are simple enough to hand-roll. The bounded queue eviction and jitter backoff are ~60 lines total. No library is warranted.

## Common Pitfalls

### Pitfall 1: Unbounded Memory from Retry Queue
**What goes wrong:** If CRM is down for hours, queue grows until OOM crash.
**Why it happens:** No cap on queue size.
**How to avoid:** D-04 specifies cap at RETRY_QUEUE_MAX_SIZE (default 1000) with oldest-drop eviction. This is already in the decisions.
**Warning signs:** Memory growth in PM2 monitoring, queue length logged at warn level.

### Pitfall 2: Backfill Re-delivering Already-Processed Messages
**What goes wrong:** After restart, backfill queries messages since `last_synced_at`, but some of those were already delivered before the crash.
**Why it happens:** `last_synced_at` is written per-message, but messages between the last write and crash are in a grey zone.
**How to avoid:** D-09 requires running backfilled messages through the DedupBuffer. However, the dedup buffer is in-memory and clears on restart. The real protection is that Tyler's CRM should be idempotent on messageId. Document this in the API contract: CRM webhook receivers must handle duplicate deliveries.
**Warning signs:** Tyler reporting duplicate messages in CRM after service restart.

### Pitfall 3: BlueBubbles `after` Parameter Uses Milliseconds
**What goes wrong:** Passing an ISO string or seconds-based timestamp to the `after` query parameter.
**Why it happens:** The BB API uses epoch milliseconds for `dateCreated` and the `after` filter parameter.
**How to avoid:** Convert the ISO `last_synced_at` string to epoch milliseconds before passing to BB: `new Date(lastSynced).getTime()`.
**Warning signs:** Backfill returning zero messages when there should be gaps, or returning the entire message history.

### Pitfall 4: Socket.IO `connect` vs Reconnect Detection
**What goes wrong:** Triggering backfill on every `connect` event, including the initial connection (which is also a startup where backfill already runs from server.ts).
**Why it happens:** Socket.IO fires `connect` on both initial connection and reconnections. There is no separate `reconnect` event in socket.io-client v4.
**How to avoid:** Track whether this is the first connection with a boolean flag. Only trigger backfill on `connect` events after the first one. Alternatively, since backfill is idempotent (dedup + sync state), running it twice on startup is harmless -- just a small performance cost.
**Warning signs:** Double backfill on startup (visible in logs).

### Pitfall 5: relayToCRM Signature Change Breaking Existing Tests
**What goes wrong:** Changing `relayToCRM` from `Promise<void>` to `Promise<boolean>` breaks all existing callers and tests.
**How to avoid:** Update the return type and ensure all existing callers handle the boolean. The bb-events.ts handlers currently call `await relayToCRM(payload)` without checking the return -- they need to check it and enqueue on failure.

## Code Examples

### BlueBubbles Message Query with `after` Parameter
```typescript
// Source: BB API docs (Postman collection / community guides)
// GET /api/v1/message?password=xxx&limit=100&sort=DESC&after=1700000000000
// Returns: { status: 200, data: BBMessage[], metadata: { count, total, offset, limit } }

async getMessagesSince(afterMs: number, offset: number, limit: number): Promise<BBMessage[]> {
  const { data } = await this.requestWithMeta<BBMessage[]>(
    `/api/v1/message?limit=${limit}&offset=${offset}&sort=ASC&after=${afterMs}`,
  );
  return data;
}
```

### Exponential Backoff with Jitter
```typescript
// D-02: initial 1s, multiply by 2, cap at 60s, +/- 20% jitter
function calculateDelay(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 60_000);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(Math.max(0, base + jitter));
}
// attempt 0: ~1000ms (+/- 200ms)
// attempt 1: ~2000ms (+/- 400ms)
// attempt 2: ~4000ms (+/- 800ms)
// attempt 3: ~8000ms (+/- 1600ms)
// attempt 4: ~16000ms (+/- 3200ms) -- last retry before discard
```

### Env Schema Extension
```typescript
// Add to envSchema in src/config/env.ts
RETRY_QUEUE_MAX_SIZE: z.string().default('1000').transform(Number),
```

### setTimeout Chain Pattern (matching project's .unref() convention)
```typescript
// From dedup.ts: this.timer = setInterval(...); this.timer.unref();
// Retry queue equivalent with setTimeout chain:
private scheduleNext(): void {
  this.timer = setTimeout(() => {
    this.processDueEntries();
    this.scheduleNext();
  }, 1000);
  this.timer.unref(); // Don't keep process alive for retry timer
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Libraries like p-retry for simple retries | Inline retry with standard setTimeout | Always been valid | No dependency for simple use cases |
| setInterval for processing loops | setTimeout chain | Best practice | Avoids overlapping execution |
| Fetch with node-fetch | Native fetch in Node.js | Node 18+ | Already using native fetch in Phase 5 |

## Open Questions

1. **BB `after` parameter exact behavior with edge cases**
   - What we know: `GET /api/v1/message?after={epochMs}` returns messages after that timestamp. Sort ASC returns oldest first.
   - What's unclear: Whether `after` is exclusive or inclusive (>= vs >). If inclusive, backfill might re-process the exact message at `last_synced_at`.
   - Recommendation: Not a problem -- dedup buffer handles duplicates. If the first message comes back as already processed, it gets deduped. No action needed.

2. **Socket.IO reconnect event detection in v4**
   - What we know: socket.io-client v4 fires `connect` on both initial connection and reconnection.
   - What's unclear: Whether there is a reliable way to distinguish first connect from reconnect without a flag.
   - Recommendation: Use a simple boolean `isFirstConnect` flag. Set to true initially, flip to false after first `connect` event. Trigger backfill only when flag is false. This is simple and reliable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOOK-03 | Failed webhook delivery enqueued for retry | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Wave 0 |
| HOOK-03 | Exponential backoff timing with jitter | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Wave 0 |
| HOOK-03 | Queue bounded at RETRY_QUEUE_MAX_SIZE, oldest dropped | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Wave 0 |
| HOOK-03 | Max 5 retries then discard | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Wave 0 |
| HOOK-03 | relayToCRM returns boolean, enqueues on failure | unit | `npx vitest run src/services/__tests__/webhook-relay.test.ts -x` | Exists (needs update) |
| HOOK-05 | Backfill queries BB with after timestamp on startup | unit | `npx vitest run src/services/__tests__/backfill.test.ts -x` | Wave 0 |
| HOOK-05 | Backfill skips when last_synced_at is null | unit | `npx vitest run src/services/__tests__/backfill.test.ts -x` | Wave 0 |
| HOOK-05 | Backfilled messages go through dedup pipeline | unit | `npx vitest run src/services/__tests__/backfill.test.ts -x` | Wave 0 |
| HOOK-05 | Backfill triggered on Socket.IO reconnect | unit | `npx vitest run src/services/__tests__/bb-events.test.ts -x` | Exists (needs update) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/retry-queue.test.ts` -- covers HOOK-03 (queue behavior, backoff, bounds, eviction)
- [ ] `src/services/__tests__/backfill.test.ts` -- covers HOOK-05 (backfill logic, null check, pagination, dedup integration)
- [ ] Update `src/services/__tests__/webhook-relay.test.ts` -- test boolean return and retry queue integration
- [ ] Update `src/services/__tests__/bb-events.test.ts` -- test reconnect backfill trigger

## Sources

### Primary (HIGH confidence)
- `src/services/webhook-relay.ts` -- current relayToCRM implementation (logs errors, returns void)
- `src/services/sync-state.ts` -- readSyncState/writeSyncState with atomic rename
- `src/services/dedup.ts` -- DedupBuffer with .unref() pattern
- `src/services/bb-events.ts` -- Socket.IO listener with connect/disconnect handlers
- `src/services/bluebubbles.ts` -- BlueBubblesClient with request/requestWithMeta patterns
- `src/config/env.ts` -- Zod envSchema with string-to-number transform pattern

### Secondary (MEDIUM confidence)
- [BlueBubbles Setup & API Guide (GitHub Gist)](https://gist.github.com/hmseeb/e313cd954ad893b75433f2f2db0fb704) -- Confirmed `GET /api/v1/message?after={epochMs}` endpoint for timestamp-based message queries
- [BlueBubbles REST API docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) -- General API structure reference

### Tertiary (LOW confidence)
- Socket.IO v4 reconnect event behavior -- based on training data knowledge of socket.io-client v4; the `connect` event fires on reconnect but there is no separate `reconnect` event in the client API. Needs validation if behavior differs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages, all patterns established in Phase 5
- Architecture: HIGH -- decisions are detailed and concrete, building blocks all exist
- Pitfalls: HIGH -- well-documented in project PITFALLS.md (Pitfall 3 and 6 are directly relevant)

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable -- no external dependency changes expected)
