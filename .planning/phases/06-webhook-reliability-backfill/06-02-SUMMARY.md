---
phase: 06-webhook-reliability-backfill
plan: 02
subsystem: api
tags: [backfill, reconnect, message-recovery, reliability]

# Dependency graph
requires:
  - phase: 06-webhook-reliability-backfill
    plan: 01
    provides: relayWithRetry, RetryQueue, initRelay/shutdownRelay
  - phase: 05-webhook-pipeline
    provides: sync-state.ts, dedup.ts, bb-events.ts, webhook-relay.ts
provides:
  - runBackfill function for message recovery after downtime
  - getMessagesSince on BlueBubblesClient for timestamp-based queries
  - Reconnect backfill trigger in bb-events
  - Startup backfill in server.ts
  - getDedup export from bb-events for shared dedup access
affects:
  - src/services/bb-events.ts (relayWithRetry, reconnect backfill, getDedup export)
  - src/server.ts (initRelay, startup backfill)
  - src/services/bluebubbles.ts (getMessagesSince method)

# Tech stack
added: []
patterns:
  - Fire-and-forget async with .catch error logging for non-blocking backfill
  - isFirstConnect flag to distinguish initial connect from reconnect (Pitfall 4)
  - Pagination loop with limit-based termination

# Key files
created:
  - src/services/backfill.ts
  - src/services/__tests__/backfill.test.ts
modified:
  - src/services/bluebubbles.ts
  - src/services/bb-events.ts
  - src/server.ts
  - src/services/__tests__/bb-events.test.ts

# Decisions
key-decisions:
  - Built InboundMessagePayload directly in backfill.ts instead of casting BBMessage to BBSocketMessage for mapInboundMessage -- avoids type casting issues since global message query lacks chat context
  - Shared dedup buffer via getDedup() export from bb-events rather than creating separate instance -- ensures correctness per D-09
  - initRelay() called before initBBEvents() in server.ts so retry queue is ready when socket events start

# Metrics
duration: 3min
completed: 2026-03-30
tasks: 2
files: 6
---

# Phase 06 Plan 02: Backfill Service & Wiring Summary

Backfill service that recovers messages missed during downtime by querying BB for messages since last_synced_at, deduplicating, and delivering via retry-enabled relay on both startup and reconnect.

## What Was Built

### Task 1: Backfill service and BB client getMessagesSince (TDD)
- **getMessagesSince(afterMs, offset, limit)** added to BlueBubblesClient -- queries GET /api/v1/message with after, offset, limit, sort=ASC
- **runBackfill(client, dedup)** in backfill.ts -- reads last_synced_at, converts ISO to epoch ms, pages through messages with limit=100, skips isFromMe and duplicates, relays via relayWithRetry, updates sync state per message
- Skips when last_synced_at is null (first run, no baseline per D-10)
- 9 unit tests: null skip, epoch conversion, relay pipeline, isFromMe skip, dedup skip, sync state updates, pagination, empty page stop, completion logging
- **Commits:** `7354153` (RED), `6d69e13` (GREEN)

### Task 2: Wire backfill into bb-events and server.ts
- **bb-events.ts:** Switched all relayToCRM calls to relayWithRetry for retry-enabled delivery. Added isFirstConnect flag -- backfill fires only on reconnect (not first connect per Pitfall 4). Added getDedup() export for shared dedup access. Reset isFirstConnect on shutdown.
- **server.ts:** Added initRelay() before initBBEvents() so retry queue is ready. Fire-and-forget startup backfill using shared dedup instance.
- 20 bb-events tests including 3 new reconnect backfill tests and 2 getDedup tests
- **Commit:** `f626c87`

## Verification Results

- Backfill tests: 9/9 passed
- bb-events tests: 20/20 passed
- Full test suite: 143/143 passed (14 test files)
- TypeScript: Pre-existing type issues only (socket.io-client types, retry-queue test mock types) -- no new issues

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all data paths are wired end-to-end.

## Self-Check: PASSED

All 6 files verified present. All 3 commits verified in git log.
