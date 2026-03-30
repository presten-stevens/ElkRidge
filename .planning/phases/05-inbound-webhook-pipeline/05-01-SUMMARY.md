---
phase: 05-inbound-webhook-pipeline
plan: 01
subsystem: webhook-pipeline-services
tags: [dedup, sync-state, webhook-relay, types, tdd]
dependency_graph:
  requires: []
  provides: [DedupBuffer, readSyncState, writeSyncState, relayToCRM, mapInboundMessage, mapDeliveryConfirmation, BBSocketMessage, WebhookPayload]
  affects: [05-02]
tech_stack:
  added: []
  patterns: [in-memory-ttl-dedup, atomic-file-write, graceful-fetch-relay]
key_files:
  created:
    - src/types/webhook.ts
    - src/services/dedup.ts
    - src/services/sync-state.ts
    - src/services/webhook-relay.ts
    - src/services/__tests__/dedup.test.ts
    - src/services/__tests__/sync-state.test.ts
    - src/services/__tests__/webhook-relay.test.ts
  modified:
    - src/types/error-codes.ts
    - src/types/bluebubbles.ts
    - .gitignore
key_decisions:
  - "DedupBuffer uses Map with setInterval cleanup (.unref) for non-blocking TTL expiry"
  - "Sync state uses temp-file-then-rename for atomic writes in same directory"
  - "Webhook relay logs errors without throwing -- Phase 6 adds retry logic"
metrics:
  duration: 2min
  completed: "2026-03-30T20:51:00Z"
  tasks_completed: 2
  tasks_total: 2
  test_count: 28
  files_changed: 10
---

# Phase 05 Plan 01: Webhook Pipeline Services Summary

In-memory GUID dedup buffer with 60s TTL, atomic JSON sync state persistence, and CRM webhook relay with payload mapping from BB Socket.IO events.

## Task Results

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Types, dedup buffer, and sync state services | 9c90463 | Done |
| 2 | Webhook relay service with tests | 87bc6ec | Done |

## What Was Built

### Types Extended
- **WEBHOOK_DELIVERY_FAILED** error code added to `error-codes.ts`
- **BBSocketMessage** interface added to `bluebubbles.ts` with all Socket.IO event fields (guid, text, handle, chats, attachments, dateDelivered, dateRead, etc.)
- **InboundMessagePayload** and **DeliveryConfirmationPayload** types in new `webhook.ts`

### DedupBuffer (src/services/dedup.ts)
- In-memory Map-based dedup with configurable TTL (default 60s)
- `isDuplicate(guid)` returns true if seen within TTL window
- Cleanup interval every 30s with `.unref()` for graceful shutdown
- `destroy()` clears interval and map

### SyncState (src/services/sync-state.ts)
- `writeSyncState(lastSyncedAt)` -- atomic write via temp file then rename in same directory
- `readSyncState()` -- returns lastSyncedAt string or null if file missing
- Auto-creates `data/` directory; `data/` added to `.gitignore`

### WebhookRelay (src/services/webhook-relay.ts)
- `mapInboundMessage(BBSocketMessage)` -- maps to InboundMessagePayload (sender from handle, threadId from chats[0])
- `mapDeliveryConfirmation(BBSocketMessage)` -- maps to DeliveryConfirmationPayload with read/delivered/unknown status
- `relayToCRM(WebhookPayload)` -- POST to CRM_WEBHOOK_URL with 10s timeout
- Graceful handling: missing URL logs warning, failed delivery logs error, neither throws

## Test Coverage

- **dedup.test.ts**: 6 tests (first call, duplicate, TTL expiry, different GUID, destroy, cleanup)
- **sync-state.test.ts**: 5 tests (write JSON, mkdir, atomic rename, read, missing file)
- **webhook-relay.test.ts**: 17 tests (mapping, relay, missing URL, error handling, timeout)
- **Full suite**: 101 tests passing, zero regressions

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all services are fully functional with real implementations.

## Decisions Made

1. **DedupBuffer cleanup strategy**: setInterval with `.unref()` avoids blocking Node.js shutdown while maintaining automatic cleanup of expired entries every 30s.
2. **Atomic file write pattern**: temp file in same directory as target ensures `rename()` is atomic (same filesystem) per Pitfall 3 from research.
3. **Relay error handling**: Errors logged but not thrown -- Phase 6 will add retry with exponential backoff on top of this foundation.

## Self-Check: PASSED

- All 7 created files verified present on disk
- Commits 9c90463 and 87bc6ec verified in git log
- Full test suite: 101/101 passing
