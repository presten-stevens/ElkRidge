---
phase: 04-read-messaging
plan: 01
subsystem: bluebubbles-client
tags: [types, service, pagination, dto-mapping, tdd]
dependency_graph:
  requires: []
  provides: [BBChat, BBMessage, BBHandle, BBPaginatedResponse, Conversation, Message, PaginatedResponse, getConversations, getMessages, requestWithMeta]
  affects: [src/services/bluebubbles.ts, src/types/bluebubbles.ts, src/types/api.ts]
tech_stack:
  added: []
  patterns: [requestWithMeta for metadata extraction, DTO mapping functions, TDD red-green]
key_files:
  created: [src/types/bluebubbles.ts, src/types/api.ts]
  modified: [src/services/bluebubbles.ts, src/services/__tests__/bluebubbles.test.ts]
decisions:
  - "requestWithMeta as separate method from request() to avoid breaking existing sendMessage"
  - "unreadCount: 0 as documented BB limitation (BB does not expose unread counts)"
  - "Module-level mapping functions (not class methods) for cleaner separation"
metrics:
  duration: 2min
  completed: "2026-03-30T19:56:20Z"
  tasks: 2
  files: 4
---

# Phase 04 Plan 01: BB Types & Client Methods Summary

BB API type definitions and clean DTOs with requestWithMeta, getConversations, getMessages extending BlueBubblesClient -- TDD with 14 new tests covering pagination metadata extraction, null handling, and DTO mapping.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create type definitions for BB API responses and API DTOs | a620eee | src/types/bluebubbles.ts, src/types/api.ts |
| 2 | Extend BlueBubblesClient with requestWithMeta, getConversations, getMessages | 942d786 | src/services/bluebubbles.ts, src/services/__tests__/bluebubbles.test.ts |

## What Was Built

### Type Definitions (Task 1)
- `src/types/bluebubbles.ts`: BBHandle, BBMessage, BBChat, BBPaginatedResponse generic -- mirrors BB API response shapes
- `src/types/api.ts`: Conversation (D-01), Message (D-02), PaginatedResponse (D-05) -- clean DTOs for route consumers

### Client Methods (Task 2)
- `requestWithMeta<T>()`: Returns both `data` and `metadata` from BB responses (solves Pitfall 1 where request() only returns data)
- `getConversations(offset, limit)`: POST /api/v1/chat/query with `with: ["lastMessage"]`, maps BBChat to Conversation
- `getMessages(chatGuid, offset, limit)`: GET /api/v1/chat/{encoded_guid}/message with sort=DESC, maps BBMessage to Message
- `mapBBChatToConversation()`: Handles null lastMessage (empty string), missing chatIdentifier (falls back to participant address), unreadCount always 0
- `mapBBMessageToMessage()`: Handles null text (empty string), null handle with isFromMe ("me"), null handle without isFromMe ("Unknown")

### Tests
- 14 new tests added to existing test file (19 total, all passing)
- Covers: requestWithMeta data+metadata extraction, error handling (BB_OFFLINE, SEND_FAILED), getConversations endpoint/mapping/pagination, getMessages endpoint/encoding/null-handling/pagination

## Decisions Made

1. **requestWithMeta as separate method**: Added alongside existing request() to avoid breaking sendMessage. request() returns data only; requestWithMeta returns { data, metadata }.
2. **unreadCount: 0**: BB does not expose unread counts. Returns 0 to keep response shape consistent with D-01 for future resolution.
3. **Module-level mapping functions**: mapBBChatToConversation and mapBBMessageToMessage are module-level functions rather than class methods -- cleaner for testing and reuse.

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all data flows are fully wired with real BB API mapping.

## Verification

- `npx vitest run src/services/__tests__/bluebubbles.test.ts`: 19/19 passing
- `npx tsc --noEmit`: Clean, no errors
- All acceptance criteria grep checks: Passing

## Self-Check: PASSED

All files exist. All commits verified.
