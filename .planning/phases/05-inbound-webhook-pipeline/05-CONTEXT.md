# Phase 5: Inbound Webhook Pipeline - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** Auto-selected defaults (--auto mode)

<domain>
## Phase Boundary

Receive real-time events from BlueBubbles via WebSocket, deduplicate them, and relay to Tyler's CRM webhook URL. Also forward delivery confirmation events (updated-message) for messages sent via POST /send. Persist last_synced_at timestamp for backfill support (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### BlueBubbles Event Connection
- **D-01:** Connect to BlueBubbles WebSocket on server startup. BB exposes a Socket.IO-compatible WebSocket at `BLUEBUBBLES_URL`.
- **D-02:** Auto-reconnect on disconnect with exponential backoff. Log reconnection attempts.
- **D-03:** Listen for `new-message` events (inbound messages) and `updated-message` events (delivery confirmations for SEND-04).

### Deduplication
- **D-04:** In-memory Map with message GUID as key and timestamp as value. TTL of 60 seconds — if the same GUID arrives within 60s, skip it.
- **D-05:** No persistence needed for dedup buffer — BB's duplicate events arrive within 1-3 seconds of each other. Buffer resets on restart (acceptable).
- **D-06:** Log when a duplicate is detected and skipped (debug level).

### CRM Webhook Relay
- **D-07:** POST to `CRM_WEBHOOK_URL` (from env, already in schema) with JSON payload.
- **D-08:** Inbound message payload: `{ type: "inbound_message", messageId: string, sender: string, body: string, timestamp: string, threadId: string }`. Matches HOOK-02 requirements.
- **D-09:** Delivery confirmation payload: `{ type: "delivery_confirmation", messageId: string, status: string, timestamp: string }`. Satisfies SEND-04.
- **D-10:** If CRM_WEBHOOK_URL is not configured, log a warning and skip relay (don't crash). This supports dev/test environments.

### last_synced_at Persistence
- **D-11:** Store in `data/last-synced.json` as `{ lastSyncedAt: "ISO8601" }`. Create `data/` directory if it doesn't exist.
- **D-12:** Update after each successfully processed message (not after each webhook delivery — that's Phase 6's retry concern).
- **D-13:** Atomic write: write to temp file, then rename. Prevents corruption on crash.
- **D-14:** Read on startup to initialize. If file doesn't exist, treat as "never synced" (backfill everything in Phase 6).

### Architecture
- **D-15:** WebSocket connection logic in `src/services/bb-events.ts`. Dedup buffer in `src/services/dedup.ts`. Webhook relay in `src/services/webhook-relay.ts`. last_synced_at in `src/services/sync-state.ts`.
- **D-16:** Services are initialized in `src/server.ts` after Express app starts — WebSocket connects, begins listening.
- **D-17:** Error codes: add `WEBHOOK_DELIVERY_FAILED` (retryable) for failed CRM POSTs. Phase 6 handles retry logic.

### Claude's Discretion
- Socket.IO client library choice (socket.io-client vs raw WebSocket)
- Exact BB WebSocket event payload shapes (researcher will verify)
- Whether to batch webhook deliveries or fire one-at-a-time
- Test mocking strategy for WebSocket events

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core vision, constraints
- `.planning/REQUIREMENTS.md` — HOOK-01, HOOK-02, HOOK-04, HOOK-06, SEND-04
- `.planning/research/SUMMARY.md` — BB webhook dedup notes (2-3 events per message)
- `.planning/research/PITFALLS.md` — BB webhook dedup, silent failures

### Existing Code
- `src/services/bluebubbles.ts` — BB client pattern to follow
- `src/types/error-codes.ts` — Add WEBHOOK_DELIVERY_FAILED
- `src/config/env.ts` — CRM_WEBHOOK_URL already in schema
- `src/server.ts` — Entry point to hook WebSocket init into
- `src/middleware/logger.ts` — Pino logger for event logging

### Prior Phase Context
- `.planning/phases/03-send-messaging/03-CONTEXT.md` — Error codes, BB client, service patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BlueBubblesClient` — Pattern for BB service class (singleton, typed)
- `AppError` + `ERROR_CODES` — Extend with WEBHOOK_DELIVERY_FAILED
- `env.CRM_WEBHOOK_URL` — Already optional in env schema
- Pino logger with credential redaction

### Established Patterns
- Singleton service pattern (getBBClient)
- Layered architecture: services handle logic, routes handle HTTP
- Error codes in centralized file

### Integration Points
- `src/server.ts` — Initialize WebSocket connection after app.listen()
- `src/types/error-codes.ts` — Add new error code
- `data/last-synced.json` — New file, add to .gitignore

</code_context>

<specifics>
## Specific Ideas

- BB fires 2-3 duplicate events per message within 1-3 seconds (from research/PITFALLS.md)
- BB uses Socket.IO protocol, not raw WebSocket
- Delivery confirmations arrive as `updated-message` events with status changes
- CRM_WEBHOOK_URL is already optional in env schema — no env changes needed

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-inbound-webhook-pipeline*
*Context gathered: 2026-03-30 via --auto mode*
