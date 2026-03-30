# Phase 4: Read Messaging - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** Auto-selected defaults (--auto mode)

<domain>
## Phase Boundary

GET /conversations and GET /conversations/:id endpoints that proxy BlueBubbles conversation and message data to Tyler's CRM. Includes offset/limit pagination. Read-only — no mutations.

</domain>

<decisions>
## Implementation Decisions

### Response Shapes
- **D-01:** GET /conversations returns array of `{ id: string, contact: string, lastMessage: string, timestamp: string, unreadCount: number }`. The `id` is the BB chatGuid that serves as the thread identifier.
- **D-02:** GET /conversations/:id returns `{ data: Message[], pagination: { offset, limit, total } }` where Message is `{ id: string, sender: string, body: string, timestamp: string, isFromMe: boolean }`.

### Pagination
- **D-03:** Offset/limit pagination as specified in READ-03. Query params: `?offset=0&limit=25`.
- **D-04:** Default limit: 25, max limit: 100. Requests exceeding max are clamped silently.
- **D-05:** Response includes pagination metadata: `{ offset: number, limit: number, total: number }` so Tyler's CRM knows if there are more pages.

### Architecture
- **D-06:** Reuse existing `BlueBubblesClient` from Phase 3 — add `getConversations()` and `getMessages(chatGuid, offset, limit)` methods.
- **D-07:** Routes stay thin per layered architecture (D-02 from Phase 2). Route parses query params, calls BB client, returns shaped response.
- **D-08:** Zod validation for query params (offset must be >= 0, limit must be 1-100).
- **D-09:** Error codes from Phase 3 apply here — `BB_OFFLINE` if BB unreachable, `VALIDATION_ERROR` for bad query params.

### Claude's Discretion
- Exact BB API endpoints for conversations and messages (researcher will verify)
- How to map BB's response format to our cleaner shape
- Whether to add type definitions for BB API responses
- Test structure (unit tests for service methods, integration tests for routes)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core vision, constraints
- `.planning/REQUIREMENTS.md` — READ-01, READ-02, READ-03
- `.planning/research/SUMMARY.md` — BB API behavior notes
- `.planning/research/PITFALLS.md` — BB-specific risks

### Phase 2 Foundation
- `src/config/env.ts` — Env schema
- `src/middleware/error-handler.ts` — Error handler with AppError support
- `src/routes/index.ts` — Router to extend with conversation routes

### Phase 3 Foundation (must read for patterns)
- `src/services/bluebubbles.ts` — BlueBubblesClient to extend with read methods
- `src/types/error-codes.ts` — Centralized error codes
- `src/types/errors.ts` — AppError class
- `src/routes/send.ts` — Route pattern to follow (thin route, service call)

### Prior Phase Context
- `.planning/phases/02-project-scaffold-configuration/02-CONTEXT.md` — Layered architecture, Zod validation
- `.planning/phases/03-send-messaging/03-CONTEXT.md` — BB client, error codes, route patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BlueBubblesClient` in `src/services/bluebubbles.ts` — Extend with getConversations, getMessages
- `AppError` + `ERROR_CODES` — Reuse for BB_OFFLINE, VALIDATION_ERROR
- `errorHandler` — Already handles AppError with code + retryable
- Router in `src/routes/index.ts` — Mount conversation routes

### Established Patterns
- Thin routes calling service methods (src/routes/send.ts pattern)
- Zod validation for input (request body in Phase 3, query params here)
- BlueBubblesClient.request<T>() for typed BB API calls

### Integration Points
- `src/services/bluebubbles.ts` — Add new methods
- `src/routes/index.ts` — Mount new route file
- No new env vars needed (BB URL/password already configured)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — straightforward BB API proxying with pagination. Auto-selected standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-read-messaging*
*Context gathered: 2026-03-30 via --auto mode*
