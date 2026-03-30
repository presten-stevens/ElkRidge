---
phase: 03-send-messaging
plan: 01
subsystem: api
tags: [error-handling, rate-limiting, bluebubbles-client, token-bucket, zod]

# Dependency graph
requires:
  - phase: 02-project-scaffold
    provides: Express app skeleton, env config, error handler, logger, test setup
provides:
  - Centralized error code constants (ERROR_CODES)
  - AppError class with code, retryable, statusCode
  - Upgraded error handler rendering AppError responses
  - BlueBubblesClient with sendMessage and offline detection
  - TokenBucket rate limiter with capacity/refill/jitter
  - Extended env schema with RATE_LIMIT_CAPACITY and RATE_LIMIT_REFILL_PER_HOUR
affects: [03-send-messaging, 04-conversations, 05-webhook-pipeline, 06-health-monitoring]

# Tech tracking
tech-stack:
  added: []
  patterns: [AppError throw/catch pattern, singleton service factories, token bucket rate limiting]

key-files:
  created:
    - src/types/error-codes.ts
    - src/types/errors.ts
    - src/services/bluebubbles.ts
    - src/services/rate-limiter.ts
    - src/services/__tests__/bluebubbles.test.ts
    - src/services/__tests__/rate-limiter.test.ts
  modified:
    - src/middleware/error-handler.ts
    - src/middleware/__tests__/error-handler.test.ts
    - src/config/env.ts
    - src/__tests__/setup.ts

key-decisions:
  - "AppError with instanceof check in error handler -- clean separation from unknown errors"
  - "SECR-04: 500+ AppErrors get generic message, 4xx get real message"
  - "BlueBubblesClient catches fetch errors without logging raw URL (password safety)"
  - "TokenBucket singleton factory pattern for shared service instances"

patterns-established:
  - "AppError pattern: services throw new AppError(msg, ERROR_CODES.X, retryable, statusCode)"
  - "Singleton factory: getRateLimiter() and getBBClient() for lazy-init service instances"
  - "Password-safe errors: never log or expose raw fetch errors containing URL params"

requirements-completed: [SEND-02, SETUP-06]

# Metrics
duration: 3min
completed: 2026-03-30
---

# Phase 3 Plan 1: Foundation Services Summary

**Error type system with AppError/error codes, BlueBubbles API client with offline detection, and token bucket rate limiter with human-like jitter**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-30T19:26:42Z
- **Completed:** 2026-03-30T19:29:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Centralized error code system (7 codes) with typed AppError class carrying code, retryable, and statusCode
- Error handler upgraded to render structured `{ error: { message, code, retryable } }` responses with SECR-04 protection
- BlueBubblesClient wrapping native fetch with password query param, 10s timeout, offline detection, and password-safe error messages
- TokenBucket rate limiter with configurable capacity (default 100), refill rate (default 4/hr), and human-like jitter (2-8s normal, 30-90s periodic long pause)

## Task Commits

Each task was committed atomically:

1. **Task 1: Error type system and error handler upgrade** - `59ab17d` (feat)
2. **Task 2: BlueBubbles client, rate limiter, and env schema extension** - `8738a27` (feat)

## Files Created/Modified
- `src/types/error-codes.ts` - Centralized SCREAMING_SNAKE error code constants
- `src/types/errors.ts` - AppError class with code, retryable, statusCode
- `src/middleware/error-handler.ts` - Upgraded to handle AppError with retryable field
- `src/middleware/__tests__/error-handler.test.ts` - Extended with AppError test cases
- `src/config/env.ts` - Added RATE_LIMIT_CAPACITY and RATE_LIMIT_REFILL_PER_HOUR
- `src/__tests__/setup.ts` - Added rate limit env vars for test setup
- `src/services/bluebubbles.ts` - BlueBubblesClient with sendMessage and offline detection
- `src/services/rate-limiter.ts` - TokenBucket with consume, getJitterMs, remainingTokens
- `src/services/__tests__/bluebubbles.test.ts` - 5 tests covering API calls, errors, password safety
- `src/services/__tests__/rate-limiter.test.ts` - 6 tests covering capacity, refill, jitter

## Decisions Made
- AppError with instanceof check in error handler -- clean separation from unknown errors
- SECR-04: 500+ AppErrors get generic message in response, 4xx get real message
- BlueBubblesClient catches fetch errors without logging raw URL (password safety per Pitfall 1)
- TokenBucket singleton factory pattern for shared service instances

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all services are fully wired with real implementations.

## Next Phase Readiness
- Error type system ready for use by POST /send route (Plan 02)
- BlueBubblesClient.sendMessage ready to be called from send endpoint
- TokenBucket rate limiter ready to gate outbound messages
- All 31 tests pass, TypeScript compiles cleanly

## Self-Check: PASSED

All 8 files verified present. Both task commits (59ab17d, 8738a27) verified in git log.

---
*Phase: 03-send-messaging*
*Completed: 2026-03-30*
