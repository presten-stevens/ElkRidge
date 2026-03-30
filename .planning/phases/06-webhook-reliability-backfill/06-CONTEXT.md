# Phase 6: Webhook Reliability & Backfill - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** Auto-selected defaults (--auto mode)

<domain>
## Phase Boundary

Retry failed CRM webhook deliveries with exponential backoff and backfill missed messages on reconnect using last_synced_at. No messages lost — the reliability layer on top of Phase 5's webhook pipeline.

</domain>

<decisions>
## Implementation Decisions

### Retry Queue
- **D-01:** In-memory retry queue in `src/services/retry-queue.ts`. Each entry: `{ payload, attempts, nextRetryAt }`.
- **D-02:** Exponential backoff: initial delay 1s, multiplied by 2 each retry, capped at 60s max delay. Jitter: +/- 20% randomization on each delay.
- **D-03:** Max 5 retries per message. After 5 failures → log error and discard (don't block the queue).
- **D-04:** Queue size capped at configurable max (default 1000, via `RETRY_QUEUE_MAX_SIZE` env var). When full, oldest entries are dropped with a warning log.
- **D-05:** Processing loop: setInterval (or setTimeout chain) checks queue every 1 second, processes entries whose `nextRetryAt` has passed. Use `.unref()` for graceful shutdown.
- **D-06:** Integrate with existing `relayToCRM` from Phase 5 — on failure, enqueue for retry instead of logging and moving on.

### Backfill on Reconnect
- **D-07:** Trigger backfill on: (1) server startup and (2) Socket.IO reconnect event. Both read `last_synced_at` from `data/last-synced.json` via existing `readSyncState()`.
- **D-08:** Query BB for messages since `last_synced_at` using existing `BlueBubblesClient.getMessages()` or a new `getMessagesSince(timestamp)` method. Paginate through all results.
- **D-09:** For each backfilled message: run through same dedup → relay → sync pipeline as live messages. This ensures no double-delivery if some were already processed.
- **D-10:** If `last_synced_at` is null (first run), skip backfill — no baseline to compare against.
- **D-11:** Backfill runs asynchronously — doesn't block server startup or Socket.IO reconnection.

### Architecture
- **D-12:** New file: `src/services/retry-queue.ts` for the retry logic.
- **D-13:** New file: `src/services/backfill.ts` for the backfill-on-reconnect logic.
- **D-14:** Modify `src/services/webhook-relay.ts` — add retry queue integration (on failure, enqueue instead of just logging).
- **D-15:** Modify `src/services/bb-events.ts` — call backfill on Socket.IO reconnect.
- **D-16:** Modify `src/server.ts` — call backfill on startup after initBBEvents.

### Claude's Discretion
- Whether to use setTimeout chain or setInterval for retry processing
- Exact BB API endpoint for querying messages by timestamp
- Whether backfill needs its own BB client method or reuses existing ones
- Test mocking strategy for retry timing

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core vision, constraints
- `.planning/REQUIREMENTS.md` — HOOK-03, HOOK-05
- `.planning/research/PITFALLS.md` — BB silent failures, message loss scenarios

### Phase 5 Foundation (must read)
- `src/services/webhook-relay.ts` — relayToCRM to integrate retry into
- `src/services/sync-state.ts` — readSyncState/writeSyncState
- `src/services/dedup.ts` — DedupBuffer for backfill dedup
- `src/services/bb-events.ts` — Socket.IO listener to add reconnect backfill
- `src/services/bluebubbles.ts` — BB client to query messages
- `src/server.ts` — Entry point for startup backfill
- `src/config/env.ts` — Add RETRY_QUEUE_MAX_SIZE env var

### Prior Phase Context
- `.planning/phases/05-inbound-webhook-pipeline/05-CONTEXT.md` — Webhook pipeline architecture

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `relayToCRM()` in webhook-relay.ts — Wrap with retry on failure
- `readSyncState()` / `writeSyncState()` in sync-state.ts — Timestamp persistence
- `DedupBuffer` in dedup.ts — Prevent double-delivery during backfill
- `BlueBubblesClient.getMessages()` — Query BB for message history
- `mapBBMessageToMessage()` in bluebubbles.ts — Already maps BB messages to clean DTOs

### Established Patterns
- Service singletons (getBBClient pattern)
- `.unref()` on intervals for graceful shutdown (from dedup.ts)
- Async fire-and-forget for non-blocking operations

### Integration Points
- `src/services/webhook-relay.ts` — Add retry queue call on failure
- `src/services/bb-events.ts` — Add backfill on reconnect
- `src/server.ts` — Add backfill on startup
- `src/config/env.ts` — Add RETRY_QUEUE_MAX_SIZE

</code_context>

<specifics>
## Specific Ideas

No specific requirements — straightforward retry + backfill. Auto-selected standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-webhook-reliability-backfill*
*Context gathered: 2026-03-30 via --auto mode*
