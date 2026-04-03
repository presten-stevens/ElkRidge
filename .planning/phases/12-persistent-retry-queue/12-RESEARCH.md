# Phase 12: Persistent Retry Queue - Research

**Researched:** 2026-04-03
**Domain:** File-based persistence for webhook retry queue (Node.js)
**Confidence:** HIGH

## Summary

Phase 12 replaces the in-memory `RetryQueue` class (array-backed, lost on restart) with a file-persisted version. The project already has an established pattern for atomic file persistence in `sync-state.ts` (temp-file-then-rename in a `data/` directory), and the retry queue should follow the same approach. The WebhookPayload type is small JSON (under 1KB per entry), the queue is bounded at 1000 entries by default, and the 1-second processing tick provides a natural write-coalescing boundary.

SQLite (better-sqlite3) would be overkill -- the queue is bounded, the payloads are small, and there are no concurrent writers. A JSON file with the same temp-write-then-rename pattern used by sync-state.ts is the correct choice: zero new dependencies, proven pattern, and adequate performance for the workload.

**Primary recommendation:** Extend `RetryQueue` to persist its internal array to `data/retry-queue.json` using the same atomic write pattern as `sync-state.ts`. Load on construction, save after mutations (debounced/coalesced to the processing tick).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EOPS-05 | Persistent retry queue that survives process restarts | JSON file persistence with atomic writes, load-on-init, save-after-mutation pattern detailed in Architecture Patterns |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:fs/promises | built-in | File read/write/rename | Already used in sync-state.ts, zero deps |
| node:path | built-in | Path construction | Already used in sync-state.ts |

### Supporting
No new dependencies required. The entire implementation uses Node.js built-ins already present in the project.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON file | better-sqlite3 | Adds native dep, build complexity, unnecessary for bounded queue of <1000 small entries |
| JSON file | LevelDB (level) | Adds dependency, overkill for single-writer bounded queue |
| Atomic rename | Direct writeFile | Risk of corrupted file on crash mid-write -- unacceptable for persistence |

## Architecture Patterns

### Recommended Approach: Extend RetryQueue with File Backing

The current `RetryQueue` class is clean and self-contained. The persistence layer should be added to it directly rather than creating a wrapper or subclass.

### Pattern 1: Atomic JSON Persistence (same as sync-state.ts)

**What:** Write queue state to a temp file, then atomically rename over the target file.
**When to use:** Every time queue state changes (enqueue, successful delivery, retry exhaustion).
**Example:**
```typescript
// Follows exact pattern from src/services/sync-state.ts
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const QUEUE_FILE = join(DATA_DIR, 'retry-queue.json');

interface PersistedEntry {
  payload: WebhookPayload;
  attempts: number;
  nextRetryAt: number;
}

async function saveQueue(entries: PersistedEntry[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmpPath = join(DATA_DIR, `.retry-queue-${Date.now()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(entries), 'utf-8');
  await rename(tmpPath, QUEUE_FILE);
}

async function loadQueue(): Promise<PersistedEntry[]> {
  try {
    const raw = await readFile(QUEUE_FILE, 'utf-8');
    return JSON.parse(raw) as PersistedEntry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}
```

### Pattern 2: Save Coalescing via Processing Tick

**What:** Rather than writing to disk on every enqueue call, mark the queue as dirty and persist at the end of each processing tick (the existing 1-second setTimeout chain).
**When to use:** To avoid excessive disk writes when multiple entries are enqueued in rapid succession (e.g., during backfill).
**Example:**
```typescript
private dirty = false;

enqueue(payload: WebhookPayload): void {
  // ... existing logic ...
  this.dirty = true;
}

private async processDueEntries(): Promise<void> {
  // ... existing processing logic ...
  // After processing, persist if anything changed
  if (this.dirty) {
    await this.persist();
    this.dirty = false;
  }
}
```

### Pattern 3: Load and Resume on Startup

**What:** On construction (or via an async `init()` method), load persisted entries and immediately begin processing them.
**When to use:** During `initRelay()` in webhook-relay.ts.
**Example:**
```typescript
// RetryQueue gains an async init method
async init(): Promise<void> {
  const entries = await loadQueue();
  this.queue = entries;
  if (entries.length > 0) {
    logger.info({ count: entries.length }, 'Loaded persisted retry queue entries');
  }
}

// In webhook-relay.ts initRelay():
export async function initRelay(): Promise<void> {
  retryQueue = new RetryQueue(env.RETRY_QUEUE_MAX_SIZE ?? 1000, 5, deliverOnce);
  await retryQueue.init();  // Load persisted entries before starting
  retryQueue.start();
}
```

**Important:** `initRelay()` currently returns `void`. Changing it to `async` requires updating the call site in `server.ts`. The call is already in an async context so this is straightforward.

### Pattern 4: Persist on Graceful Shutdown

**What:** On `destroy()`, persist any remaining queue entries before clearing.
**When to use:** During `shutdownRelay()`.
**Example:**
```typescript
async destroy(): Promise<void> {
  if (this.timer) {
    clearTimeout(this.timer);
    this.timer = null;
  }
  await this.persist();  // Save before clearing
  this.queue = [];
}
```

**Note:** `destroy()` becomes async. `shutdownRelay()` must be updated accordingly.

### Recommended Project Structure Change
```
data/
  last-synced.json     # Existing (sync-state.ts)
  retry-queue.json     # NEW (persistent retry queue)
```

### Anti-Patterns to Avoid
- **Writing on every enqueue:** During backfill, dozens of entries may be enqueued in quick succession. Coalesce writes to the processing tick.
- **Storing the deliverFn or timer in persisted state:** Only persist payload, attempts, and nextRetryAt. The function reference and timer are runtime-only.
- **Blocking startup on empty file:** If no file exists, start with empty queue -- do not error.
- **Subclassing or wrapping RetryQueue:** The class is small enough that adding persistence directly is cleaner than inheritance or decorator patterns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file writes | Custom fsync + write | temp-file-then-rename | Already proven in sync-state.ts, handles crash-safety |
| JSON schema validation on load | Custom validation | Type assertion with defensive checks | Queue is bounded and written by our own code, not user input |

**Key insight:** The entire persistence mechanism is ~30 lines of code using patterns already in the codebase. No external libraries needed.

## Common Pitfalls

### Pitfall 1: stale nextRetryAt timestamps after restart
**What goes wrong:** Entries persisted with `nextRetryAt` set to absolute timestamps (e.g., `Date.now() + 4000`) will have past timestamps when loaded after a restart, causing all entries to be "due" immediately.
**Why it happens:** Time passes between persistence and reload.
**How to avoid:** This is actually DESIRED behavior. If the service was down, entries should be retried promptly on restart. The existing `processDueEntries` processes ONE entry per tick, so even if all entries are "due," they will be processed one-per-second, providing natural throttling.
**Warning signs:** All entries firing simultaneously on restart. The one-per-tick design already prevents this.

### Pitfall 2: initRelay becoming async breaks call chain
**What goes wrong:** `initRelay()` is currently synchronous and called in `server.ts`. Making it async requires `await`.
**Why it happens:** File I/O is inherently async.
**How to avoid:** Update `initRelay` signature to return `Promise<void>` and add `await` at the call site in `server.ts`. The call site is already inside an async function.
**Warning signs:** Unhandled promise rejection on startup.

### Pitfall 3: destroy() becoming async breaks shutdown
**What goes wrong:** `shutdownRelay()` calls `destroy()`. If `destroy()` becomes async, the shutdown may not complete the final persist.
**Why it happens:** Need to await the final file write.
**How to avoid:** Make both `destroy()` and `shutdownRelay()` async and await them. Check all call sites.
**Warning signs:** Queue file not updated on graceful shutdown.

### Pitfall 4: Corrupted JSON on unexpected crash
**What goes wrong:** If process crashes during a non-atomic write, the file could be corrupted.
**Why it happens:** Direct `writeFile` without atomic rename.
**How to avoid:** Always use temp-file-then-rename pattern. A crash during write leaves the temp file orphaned but the main file intact.
**Warning signs:** `JSON.parse` errors on startup load.

### Pitfall 5: Queue file growing with stale temp files
**What goes wrong:** Temp files `.retry-queue-{timestamp}.tmp` accumulate if crashes happen during writes.
**Why it happens:** Rename never completes.
**How to avoid:** On startup load, optionally clean up `.tmp` files in the data directory. Not critical but good hygiene. The sync-state.ts does NOT do this currently, so follow the same convention (ignore stale temps).
**Warning signs:** Multiple `.tmp` files in `data/` directory.

## Code Examples

### Current RetryQueue Interface (must preserve)
```typescript
// src/services/retry-queue.ts - current public API
class RetryQueue {
  constructor(maxSize: number, maxRetries: number, deliverFn: (payload: WebhookPayload) => Promise<boolean>)
  enqueue(payload: WebhookPayload): void     // Will stay sync (dirty flag, persist on tick)
  get size(): number
  start(): void
  destroy(): void                             // Will become async
}
```

### Current webhook-relay.ts Integration Points
```typescript
// These functions need updates:
export function initRelay(): void          // -> async, await retryQueue.init()
export function shutdownRelay(): void      // -> async, await retryQueue.destroy()

// These functions are UNCHANGED:
export async function relayToCRM(payload: WebhookPayload): Promise<boolean>
export async function relayWithRetry(payload: WebhookPayload): Promise<void>
```

### WebhookPayload Types (persisted as-is)
```typescript
// src/types/webhook.ts - these are pure data, safe to serialize
export type WebhookPayload = InboundMessagePayload | DeliveryConfirmationPayload;
```

Both payload types contain only strings -- fully JSON-serializable with no special handling needed.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-memory array | In-memory array (current) | Phase 6 | Entries lost on restart |
| In-memory array | JSON file with atomic writes (this phase) | Phase 12 | Entries survive restarts |

**Why not SQLite:** The queue is bounded at 1000 entries max, each entry is <1KB, there is a single writer, and reads happen only on startup. JSON file is the right tool. SQLite would be warranted if: unbounded entries, concurrent readers/writers, or query requirements beyond "load all."

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | Inferred from package.json (no vitest.config.ts) |
| Quick run command | `npx vitest run src/services/__tests__/retry-queue.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EOPS-05a | Queue entries written to disk after enqueue | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Exists (needs new tests) |
| EOPS-05b | Queue entries loaded from disk on init | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Exists (needs new tests) |
| EOPS-05c | Entries survive simulated restart (save+destroy+new instance+load) | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Exists (needs new tests) |
| EOPS-05d | Corrupt/missing file handled gracefully on load | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Exists (needs new tests) |
| EOPS-05e | Backoff behavior unchanged from in-memory version | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts -x` | Exists (covered) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/services/__tests__/retry-queue.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] New test cases in `src/services/__tests__/retry-queue.test.ts` for persistence (save, load, restart simulation, corrupt file handling)
- [ ] Mock `node:fs/promises` in tests to avoid real disk I/O (or use a temp directory)

## Open Questions

1. **Should `enqueue()` stay synchronous?**
   - What we know: Making it async would change the call site in `relayWithRetry` (already async, so no issue). But the dirty-flag + coalesced-write approach keeps it sync, which is simpler.
   - Recommendation: Keep `enqueue()` sync with dirty flag. Persist on the processing tick. This preserves the current call pattern exactly.

2. **Should the file path be configurable via env?**
   - What we know: `sync-state.ts` hardcodes `data/last-synced.json`. No env config for file paths exists in the project.
   - Recommendation: Follow the same convention. Hardcode `data/retry-queue.json`. No new env var needed.

## Sources

### Primary (HIGH confidence)
- Source code: `src/services/retry-queue.ts` - current implementation analyzed directly
- Source code: `src/services/sync-state.ts` - existing atomic write pattern
- Source code: `src/services/webhook-relay.ts` - integration points
- Source code: `src/types/webhook.ts` - payload types (all string fields, JSON-safe)
- Source code: `src/config/env.ts` - existing RETRY_QUEUE_MAX_SIZE config

### Secondary (MEDIUM confidence)
- Node.js fs/promises documentation - rename atomicity guarantees on same-filesystem paths

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, uses Node.js built-ins already in use
- Architecture: HIGH - follows exact pattern established in sync-state.ts
- Pitfalls: HIGH - identified from direct code analysis of current implementation

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable -- no external dependencies to go stale)
