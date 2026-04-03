# Phase 13: Delivery Status API - Research

**Researched:** 2026-04-03
**Domain:** In-memory status tracking, REST endpoint, BlueBubbles updated-message events
**Confidence:** HIGH

## Summary

Phase 13 adds a GET /messages/:id/status endpoint so Tyler can query delivery status of sent messages without relying solely on webhook events. The codebase already handles `updated-message` socket events in `bb-events.ts` and maps them to `DeliveryConfirmationPayload` via `webhook-relay.ts`. The existing `mapDeliveryConfirmation()` already derives `delivered`/`read`/`unknown` status from `dateDelivered` and `dateRead` fields on `BBSocketMessage`. The implementation needs to: (1) store these statuses in an in-memory Map with TTL cleanup, (2) link the `tempGuid` returned by POST /send to the real BB message GUID, and (3) expose the status via a new route.

**Primary recommendation:** Create a `StatusStore` class following the exact same Map + setInterval TTL cleanup pattern as `DedupBuffer`, populate it from `handleUpdatedMessage` in `bb-events.ts`, and expose via a new `GET /messages/:id/status` route mounted in the protected router.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EOPS-06 | Delivery status query API for sent messages | StatusStore service captures updated-message events; GET /messages/:id/status route exposes them; tempGuid-to-GUID mapping links POST /send response IDs to BB message GUIDs |
</phase_requirements>

## Standard Stack

### Core

No new dependencies required. This phase uses only existing libraries already in the project.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.x | Route handler for GET /messages/:id/status | Already in project |
| zod | 3.x | Param validation | Already in project |

### Supporting

None -- pure in-memory implementation with existing dependencies.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory Map | SQLite/file persistence | Overkill -- status is ephemeral, TTL-bounded, and non-critical. If process restarts, status is unknown (acceptable for a query-only convenience endpoint). Project explicitly avoids databases (REQUIREMENTS.md: "Tyler handles all persistence"). |

## Architecture Patterns

### Recommended Project Structure

```
src/
  services/
    status-store.ts      # StatusStore class (Map + TTL cleanup)
  routes/
    messages.ts          # GET /messages/:id/status route
  types/
    webhook.ts           # (extend) DeliveryStatus type
```

### Pattern 1: StatusStore (Map + setInterval TTL Cleanup)

**What:** An in-memory store that maps message IDs (both tempGuid and real BB GUID) to delivery status objects. Uses `setInterval` with `.unref()` for non-blocking periodic cleanup, identical to `DedupBuffer`.

**When to use:** Ephemeral status tracking where persistence across restarts is not required.

**Example:**
```typescript
// Follows DedupBuffer pattern from src/services/dedup.ts
export class StatusStore {
  private store = new Map<string, StatusEntry>();
  private timer: ReturnType<typeof setInterval>;

  constructor(private readonly ttlMs: number = 3_600_000) { // 1 hour default
    this.timer = setInterval(() => this.cleanup(), 60_000);
    this.timer.unref();
  }

  set(messageId: string, status: DeliveryStatus): void {
    this.store.set(messageId, { status, updatedAt: Date.now() });
  }

  get(messageId: string): StatusEntry | undefined {
    return this.store.get(messageId);
  }

  // Link tempGuid -> same status entry as real GUID
  link(tempGuid: string, realGuid: string): void {
    const entry = this.store.get(realGuid);
    if (entry) this.store.set(tempGuid, entry);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.updatedAt >= this.ttlMs) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.timer);
    this.store.clear();
  }
}
```

### Pattern 2: Route Pattern (Matches send.ts / conversations.ts)

**What:** Zod-validated route with AppError for error handling.

**Example:**
```typescript
import { Router } from 'express';
import { z } from 'zod';
import { getStatusStore } from '../services/status-store.js';

const paramsSchema = z.object({
  id: z.string().min(1, 'Message ID is required'),
});

export const messagesRouter = Router();

messagesRouter.get('/messages/:id/status', async (req, res) => {
  const parsed = paramsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw new AppError(/* ... */);
  }

  const store = getStatusStore();
  const entry = store.get(parsed.data.id);

  if (!entry) {
    res.status(200).json({
      messageId: parsed.data.id,
      status: 'unknown',
      message: 'No delivery status available for this message',
    });
    return;
  }

  res.status(200).json({
    messageId: parsed.data.id,
    status: entry.status,
    updatedAt: new Date(entry.updatedAt).toISOString(),
  });
});
```

### Pattern 3: Singleton Service Pattern (Matches getBBClient, getRateLimiter)

**What:** Module-level singleton with `getStatusStore()` export for shared access across bb-events.ts and the route.

```typescript
let instance: StatusStore | null = null;

export function getStatusStore(): StatusStore {
  if (!instance) {
    instance = new StatusStore(env.STATUS_TTL_MS);
  }
  return instance;
}

export function shutdownStatusStore(): void {
  instance?.destroy();
  instance = null;
}
```

### Anti-Patterns to Avoid

- **Storing status forever without TTL:** Memory will grow unbounded. Must have TTL cleanup.
- **Returning 404 for unknown status:** A missing status is not an error -- the message may simply not have a delivery event yet. Return 200 with `status: 'unknown'`.
- **Blocking on BB API lookup for status:** Do not call BB's API per request. Status comes passively from socket events. The endpoint is read-only against the in-memory store.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TTL cleanup | Custom eviction logic | Map + setInterval pattern (DedupBuffer) | Already proven in this codebase, handles .unref() correctly |
| Status derivation | Custom date parsing | Existing `mapDeliveryConfirmation()` logic | Already maps dateDelivered/dateRead to status string |

## Common Pitfalls

### Pitfall 1: tempGuid vs Real BB GUID Linkage

**What goes wrong:** POST /send returns a `tempGuid` (crypto.randomUUID), but BB's updated-message events reference the real BB GUID (e.g., `iMessage;-;guid-1234`). Without linking them, Tyler cannot query status using the ID returned from POST /send.

**Why it happens:** The fire-and-forget pattern in send.ts discards the BB response. The actual BB GUID comes back from `client.sendMessage()` but is never captured.

**How to avoid:** Two approaches:
1. **Capture BB GUID from sendMessage response:** Modify the fire-and-forget block in send.ts to store the mapping `tempGuid -> realGuid` in the StatusStore after sendMessage resolves. The sendMessage response already returns `{ guid, text }`.
2. **Also index by tempGuid in BB:** BlueBubbles accepts a `tempGuid` parameter in the send request. The `updated-message` event MAY include this tempGuid in the message data. If it does, the StatusStore should index by both.

**Recommended approach:** Option 1 is reliable and does not depend on BB behavior. In the fire-and-forget setTimeout in send.ts, after `client.sendMessage()` succeeds, call `getStatusStore().set(realGuid, 'sent')` and `getStatusStore().link(tempGuid, realGuid)`.

**Warning signs:** Tyler queries by the messageId from POST /send response and always gets "unknown".

### Pitfall 2: Dedup Buffer Filtering Out Status Updates

**What goes wrong:** The `handleUpdatedMessage` function in bb-events.ts calls `dedup?.isDuplicate(data.guid)` before processing. If an updated-message event fires for a GUID that was already seen (e.g., first as "delivered", then as "read"), the second event gets deduped and the status never updates to "read".

**Why it happens:** The dedup buffer was designed for new-message dedup (where BB fires 2-3 identical events), not for status progression where the same GUID legitimately updates.

**How to avoid:** For updated-message events, either: (a) skip dedup entirely (status updates are idempotent -- setting "read" twice is harmless), or (b) use a separate dedup key that includes the status (e.g., `${guid}:delivered` vs `${guid}:read`). Option (a) is simpler and correct.

**Warning signs:** Messages show "delivered" but never progress to "read" even though the recipient has read them.

### Pitfall 3: Status TTL Too Short

**What goes wrong:** If TTL is too short (e.g., 5 minutes matching dedup), Tyler queries for a recently sent message and gets "unknown" because the entry was already cleaned up.

**Why it happens:** Delivery confirmation can take seconds to hours depending on recipient's device state.

**How to avoid:** Default TTL of 1 hour (3,600,000ms) with configurable `STATUS_TTL_MS` env var. This is long enough for typical delivery flows but bounded enough to prevent unbounded growth. For reference: most iMessage deliveries confirm within seconds, but read receipts can take hours.

**Warning signs:** Status entries disappearing before Tyler can query them.

### Pitfall 4: Memory Growth Under High Volume

**What goes wrong:** If many messages are sent per hour, the status Map grows large.

**Why it happens:** Each entry is small (~200 bytes) but without bounds, could grow.

**How to avoid:** The 1-hour TTL naturally bounds growth. At 100 messages/hour (rate limiter capacity), the Map holds at most ~100 entries at any time. No explicit size cap needed, but a configurable `STATUS_MAX_ENTRIES` could be added as defense-in-depth with an LRU eviction (drop oldest on insert).

## Code Examples

### BlueBubbles updated-message Event Shape

From `src/types/bluebubbles.ts`, the `BBSocketMessage` interface already has all needed fields:

```typescript
// Already exists in the codebase
interface BBSocketMessage {
  guid: string;           // Real BB message GUID
  dateDelivered: number;  // Epoch ms, 0 if not delivered
  dateRead: number;       // Epoch ms, 0 if not read
  isFromMe: boolean;      // true for sent messages
  error: number;          // non-zero indicates send failure
  // ... other fields
}
```

### Status Derivation Logic (Already Exists)

From `src/services/webhook-relay.ts`:

```typescript
// Already exists -- reuse this logic
export function mapDeliveryConfirmation(data: BBSocketMessage): DeliveryConfirmationPayload {
  const status = data.dateRead > 0 ? 'read' : data.dateDelivered > 0 ? 'delivered' : 'unknown';
  return {
    type: 'delivery_confirmation',
    messageId: data.guid,
    status,
    timestamp: new Date(data.dateDelivered || data.dateRead || data.dateCreated).toISOString(),
  };
}
```

### Integration Point: bb-events.ts handleUpdatedMessage

The existing handler already processes delivery updates. The StatusStore integration hooks in here:

```typescript
async function handleUpdatedMessage(data: BBSocketMessage): Promise<void> {
  try {
    if (!data.isFromMe) return;
    // REMOVE dedup check for updated-message (Pitfall 2)
    // if (dedup?.isDuplicate(data.guid)) return;

    // NEW: Store status in StatusStore
    const status = data.dateRead > 0 ? 'read' : data.dateDelivered > 0 ? 'delivered' : 'sent';
    getStatusStore().set(data.guid, status);

    // Existing: relay to CRM webhook
    const payload = mapDeliveryConfirmation(data);
    await relayWithRetry(payload);
  } catch (err) {
    // ... error handling
  }
}
```

### Integration Point: send.ts Fire-and-Forget Block

```typescript
// Inside the setTimeout callback in send.ts
setTimeout(async () => {
  try {
    const result = await client.sendMessage(phone, parsed.data.message);
    // NEW: Record initial status and link tempGuid to real GUID
    const store = getStatusStore();
    store.set(result.guid, 'sent');
    store.link(tempGuid, result.guid);
    logger.info({ tempGuid, realGuid: result.guid, phone, jitterMs }, 'Message sent to BlueBubbles');
  } catch (err) {
    // NEW: Record failure status
    getStatusStore().set(tempGuid, 'failed');
    logger.error(/* ... */);
  }
  resolve();
}, jitterMs);
```

### Env Schema Extension

```typescript
// Add to envSchema in src/config/env.ts
STATUS_TTL_MS: z.string().default('3600000').transform(Number),  // 1 hour
```

### Response Shape

```typescript
// GET /messages/:id/status -- status found
{
  "messageId": "abc-123-def",
  "status": "delivered",  // "sent" | "delivered" | "read" | "failed" | "unknown"
  "updatedAt": "2026-04-03T12:00:00.000Z"
}

// GET /messages/:id/status -- no status tracked
{
  "messageId": "abc-123-def",
  "status": "unknown",
  "message": "No delivery status available for this message"
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Webhook-only delivery status | Webhook + query API | This phase | Tyler can poll for status instead of relying on webhook receipt |

## Open Questions

1. **Should the link() method share the same object reference or copy?**
   - What we know: If link() stores a reference, updating the real GUID entry updates the tempGuid entry too (desired). If it copies, they diverge.
   - What's unclear: Edge case behavior with TTL cleanup (if real GUID entry is cleaned up, does tempGuid entry still exist?)
   - Recommendation: Store the status string directly under both keys (simple copy). When updating status via real GUID, also update under any linked tempGuid. Use a reverse map `realGuid -> tempGuid` for this.

2. **Should failed sends (BB error) be tracked as "failed" status?**
   - What we know: `BBSocketMessage.error` field is non-zero on send failure. The fire-and-forget catch block knows about failures.
   - What's unclear: Whether Tyler wants to see "failed" or prefers to just get "unknown"
   - Recommendation: Track "failed" -- it is more informative. Set in the catch block of send.ts fire-and-forget.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (assumed from project patterns) or manual curl |
| Config file | Check for vitest.config.ts or jest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EOPS-06a | GET /messages/:id/status returns delivery state | integration | curl + manual verification | No - Wave 0 |
| EOPS-06b | StatusStore tracks updated-message events | unit | StatusStore.set/get test | No - Wave 0 |
| EOPS-06c | Status entries have TTL and auto-cleanup | unit | StatusStore cleanup test | No - Wave 0 |
| EOPS-06d | Unknown message returns clear response | integration | curl with unknown ID | No - Wave 0 |

### Sampling Rate
- **Per task commit:** Manual curl test against running server
- **Per wave merge:** Full test suite if available
- **Phase gate:** All 4 behaviors verified before /gsd:verify-work

### Wave 0 Gaps
- [ ] `tests/status-store.test.ts` -- covers EOPS-06b, EOPS-06c
- [ ] `tests/messages-route.test.ts` -- covers EOPS-06a, EOPS-06d

## Sources

### Primary (HIGH confidence)
- Project source code: `src/services/bb-events.ts`, `src/services/webhook-relay.ts`, `src/services/dedup.ts`, `src/types/bluebubbles.ts` -- direct inspection of existing event handling and status derivation
- Project source code: `src/routes/send.ts` -- fire-and-forget pattern with tempGuid
- Project source code: `src/services/bluebubbles.ts` -- sendMessage returns `{ guid, text }` confirming real GUID is available

### Secondary (MEDIUM confidence)
- BlueBubbles API behavior: `updated-message` socket event shape inferred from BBSocketMessage type and existing handleUpdatedMessage handler

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, uses existing project patterns
- Architecture: HIGH - follows established DedupBuffer/singleton patterns exactly
- Pitfalls: HIGH - derived from direct code analysis (dedup conflict, tempGuid gap are concrete)

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable -- internal patterns only)
