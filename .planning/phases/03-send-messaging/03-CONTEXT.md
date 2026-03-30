# Phase 3: Send Messaging - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

POST /send endpoint that sends iMessages through BlueBubbles with proper error handling, queued status response, and rate limiting with jitter to prevent Apple spam flagging. This phase also creates the shared BlueBubbles API client that all subsequent phases will use.

</domain>

<decisions>
## Implementation Decisions

### Error Response Format
- **D-01:** Flat SCREAMING_SNAKE error codes with a `retryable: boolean` field in every error response. Response shape: `{ error: { message, code, retryable } }`.
- **D-02:** Error codes defined in a single `src/types/error-codes.ts` file as an exported const object to prevent string drift.
- **D-03:** Error code set for Phase 3: `VALIDATION_ERROR` (Zod failures, not retryable), `INVALID_PHONE` (E.164 normalization rejection, not retryable), `RATE_LIMITED` (token bucket exhausted, retryable), `BB_OFFLINE` (BlueBubbles unreachable, retryable), `BB_IMESSAGE_DISCONNECTED` (iMessage sign-out, retryable), `SEND_FAILED` (BB returned error but was reachable, not retryable).
- **D-04:** Update existing `src/middleware/error-handler.ts` to support the new error code and retryable fields.

### Rate Limiting
- **D-05:** Token bucket algorithm, in-memory, per-instance (one instance = one phone number). No external dependencies.
- **D-06:** Default capacity: 100 tokens (configurable via env). Refill rate: ~4 tokens/hour. State resets on restart (acceptable — conservative cold start).
- **D-07:** Jitter on every send: 2-8 second base delay with occasional longer pauses (30-90s) after every 3-5 sends. Goal: make send cadence look human to Apple's detection.
- **D-08:** When bucket is empty, return 429 with `RATE_LIMITED` error code and `retryable: true`. Do not queue — reject immediately and let Tyler's CRM retry.

### BlueBubbles API Client
- **D-09:** Shared `BlueBubblesClient` service class in `src/services/bluebubbles.ts`. Centralizes BB URL + password config, handles auth, detects BB offline state, provides typed responses.
- **D-10:** All future phases import this client — no direct fetch calls to BB from route handlers.
- **D-11:** BB offline detection: catch fetch errors (ECONNREFUSED, timeout) and throw typed errors that map to `BB_OFFLINE`. iMessage disconnection detected via BB API health response.

### Send Endpoint
- **D-12:** POST /send accepts `{ to: string, message: string }`. Validates with Zod (per Phase 2 decision D-09). Phone number normalized via `normalizePhone()` utility.
- **D-13:** Response on success: `{ messageId: string, status: "queued" }`. "queued" not "delivered" — reflects actual iMessage behavior (SEND-03).
- **D-14:** Route stays thin (parse request, call service, return response). Business logic (BB API call, rate limiting check) lives in service layer per Phase 2 architecture (D-02).

### Claude's Discretion
- Whether to use native `fetch` or a library like `undici` for BB API calls
- Exact token bucket implementation details (class vs function)
- Test structure for send endpoint (unit tests for service, integration test for route)
- Whether to add a `Retry-After` header on 429 responses

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` -- Core vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` -- Full v1 requirement list (SEND-01, SEND-02, SEND-03, SETUP-06)
- `.planning/research/SUMMARY.md` -- Research synthesis with BB API behavior notes
- `.planning/research/PITFALLS.md` -- Apple spam flagging threshold (~100/day), BB silent failures

### Phase 2 Foundation (must read for patterns)
- `src/config/env.ts` -- Zod env schema, env object shape
- `src/middleware/error-handler.ts` -- Existing error handler to extend
- `src/middleware/logger.ts` -- Pino logger with redaction
- `src/utils/phone.ts` -- normalizePhone() utility
- `src/routes/index.ts` -- Router placeholder to extend
- `src/app.ts` -- Express app factory

### Prior Phase Context
- `.planning/phases/02-project-scaffold-configuration/02-CONTEXT.md` -- Layered architecture, Zod for request validation, TypeScript decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `normalizePhone()` in `src/utils/phone.ts` -- E.164 normalization for the `to` field
- `errorHandler` in `src/middleware/error-handler.ts` -- Extend with error codes and retryable field
- `env` in `src/config/env.ts` -- Already has `BLUEBUBBLES_URL` and `BLUEBUBBLES_PASSWORD`
- `envSchema` in `src/config/env.ts` -- Add rate limit config vars (RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_HOUR)
- Router in `src/routes/index.ts` -- Add POST /send route

### Established Patterns
- Zod for validation (env vars in Phase 2, request bodies in Phase 3)
- Pino structured logging with credential redaction
- Layered: routes → services → middleware
- Error responses: `{ error: { message, code } }` (extend with `retryable`)

### Integration Points
- `src/routes/index.ts` -- Mount send route
- `src/config/env.ts` -- Add new env vars for rate limiting
- `src/middleware/error-handler.ts` -- Upgrade to support error codes + retryable

</code_context>

<specifics>
## Specific Ideas

- Apple reportedly flags accounts at ~100+ messages/day -- the 100-token default maps directly to this
- BlueBubbles send endpoint returns "queued" not "delivered" -- our API must reflect this honestly (SEND-03)
- BB fires 2-3 duplicate webhook events per message (Phase 5 concern, not Phase 3)
- Jitter pattern: 2-8s base + occasional 30-90s pauses mimics human texting cadence

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 03-send-messaging*
*Context gathered: 2026-03-30*
