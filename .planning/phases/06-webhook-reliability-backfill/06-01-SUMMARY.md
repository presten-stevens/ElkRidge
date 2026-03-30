---
phase: 06-webhook-reliability-backfill
plan: 01
subsystem: api
tags: [retry-queue, exponential-backoff, webhook, reliability]

# Dependency graph
requires:
  - phase: 05-webhook-pipeline
    provides: relayToCRM, webhook-relay.ts, dedup.ts with .unref() pattern
provides:
  - RetryQueue class with bounded queue, exponential backoff, jitter
  - relayToCRM returning boolean for success/failure signaling
  - relayWithRetry as new entry point with automatic retry enqueue
  - initRelay/shutdownRelay lifecycle management
  - RETRY_QUEUE_MAX_SIZE env var
affects: [06-02-backfill-reconnect, bb-events integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [setTimeout chain with .unref() for retry processing, deliverFn callback pattern]

key-files:
  created:
    - src/services/retry-queue.ts
    - src/services/__tests__/retry-queue.test.ts
  modified:
    - src/services/webhook-relay.ts
    - src/services/__tests__/webhook-relay.test.ts
    - src/config/env.ts

key-decisions:
  - "Extracted deliverOnce as private function reused by both relayToCRM and retry queue deliverFn callback"
  - "setTimeout chain (not setInterval) for retry processing to avoid overlap"
  - "processDueEntries processes ONE entry per tick to avoid hammering recovering CRM"

patterns-established:
  - "RetryQueue: bounded in-memory queue with exponential backoff, jitter, and configurable max retries"
  - "deliverFn callback injection for testable retry delivery"

requirements-completed: [HOOK-03]

# Metrics
duration: 3min
completed: 2026-03-30
---

# Phase 6 Plan 1: Webhook Retry Queue Summary

**In-memory retry queue with exponential backoff (1s base, 2x, 60s cap, +/-20% jitter), bounded at RETRY_QUEUE_MAX_SIZE, integrated into webhook relay pipeline**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-30T22:09:41Z
- **Completed:** 2026-03-30T22:13:07Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- RetryQueue class with bounded queue, exponential backoff with jitter, max 5 retries, and .unref() timer
- relayToCRM returns Promise<boolean> so callers know delivery succeeded or failed
- relayWithRetry enqueues failed deliveries for automatic retry
- initRelay/shutdownRelay manage retry queue lifecycle
- RETRY_QUEUE_MAX_SIZE env var added (default 1000)
- Full test coverage: 7 retry-queue tests + 23 webhook-relay tests, 129 total suite green

## Task Commits

Each task was committed atomically:

1. **Task 1: RetryQueue class and env schema extension** - `a67fcce` (test: RED), `838135c` (feat: GREEN)
2. **Task 2: Integrate retry queue into webhook relay** - `8a7303c` (test: RED), `df0de60` (feat: GREEN)

_TDD tasks have RED (failing test) and GREEN (implementation) commits._

## Files Created/Modified
- `src/services/retry-queue.ts` - RetryQueue class with bounded queue, backoff, jitter, setTimeout chain
- `src/services/__tests__/retry-queue.test.ts` - 7 unit tests covering enqueue, eviction, delivery, exhaustion, destroy
- `src/services/webhook-relay.ts` - relayToCRM returns boolean, added relayWithRetry, initRelay, shutdownRelay
- `src/services/__tests__/webhook-relay.test.ts` - 23 tests including new boolean return, retry integration, lifecycle
- `src/config/env.ts` - Added RETRY_QUEUE_MAX_SIZE with string-to-number transform

## Decisions Made
- Extracted deliverOnce as a private function shared by relayToCRM (direct call) and retry queue (deliverFn callback), avoiding code duplication
- setTimeout chain chosen over setInterval per research recommendation to prevent overlap if processing takes longer than interval
- processDueEntries processes one entry per tick per anti-pattern guidance to avoid hammering a recovering CRM endpoint
- RetryQueue mock in webhook-relay tests uses function constructor pattern for vitest compatibility with `new` operator

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- RetryQueue vi.mock needed `function` constructor syntax instead of arrow function for `new` operator compatibility in vitest -- resolved by using `vi.fn().mockImplementation(function() {...})` pattern

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- relayWithRetry is ready for bb-events.ts to switch to (Plan 02 integration point)
- initRelay/shutdownRelay ready for server.ts lifecycle integration (Plan 02)
- HOOK-03 fully satisfied: retry with exponential backoff, bounded queue, max retries

---
*Phase: 06-webhook-reliability-backfill*
*Completed: 2026-03-30*
