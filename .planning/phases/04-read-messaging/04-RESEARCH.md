# Phase 4: Read Messaging - Research

**Researched:** 2026-03-30
**Domain:** BlueBubbles REST API conversation/message retrieval, pagination, response normalization
**Confidence:** HIGH

## Summary

Phase 4 adds two read-only GET endpoints that proxy BlueBubbles conversation and message data to Tyler's CRM. The BB API provides `POST /api/v1/chat/query` for listing conversations (with optional `lastMessage` inclusion via the `with` parameter) and `GET /api/v1/chat/{guid}/message` for retrieving messages in a specific thread. Both BB endpoints support offset/limit pagination and return metadata with `{ count, total, offset, limit }`.

The main discovery is that BlueBubbles does NOT provide an `unreadCount` field on chat objects. The Chat entity has a `lastReadMessageTimestamp` column but the ChatSerializer does not expose unread counts. The CONTEXT.md decision (D-01) specifies returning `unreadCount` in the conversation list response. The implementation will need to either: (a) compute unread count by querying messages after `lastReadMessageTimestamp` for each chat (expensive, multiple API calls), or (b) return a simpler `hasUnreadMessages` boolean derived from comparing timestamps, or (c) return `0` as a placeholder and document this as a known limitation. The recommendation is option (c) -- return `unreadCount: 0` with a comment noting BB does not expose this data natively, keeping the response shape as specified in D-01 so Tyler's CRM schema doesn't need to change if this is solved later.

**Primary recommendation:** Extend `BlueBubblesClient` with `getConversations(offset, limit)` and `getMessages(chatGuid, offset, limit)` methods. Map BB's verbose response shapes to the clean DTOs specified in D-01/D-02. Use Zod for query param validation. Return `unreadCount: 0` as a documented limitation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** GET /conversations returns array of `{ id: string, contact: string, lastMessage: string, timestamp: string, unreadCount: number }`. The `id` is the BB chatGuid that serves as the thread identifier.
- **D-02:** GET /conversations/:id returns `{ data: Message[], pagination: { offset, limit, total } }` where Message is `{ id: string, sender: string, body: string, timestamp: string, isFromMe: boolean }`.
- **D-03:** Offset/limit pagination as specified in READ-03. Query params: `?offset=0&limit=25`.
- **D-04:** Default limit: 25, max limit: 100. Requests exceeding max are clamped silently.
- **D-05:** Response includes pagination metadata: `{ offset: number, limit: number, total: number }` so Tyler's CRM knows if there are more pages.
- **D-06:** Reuse existing `BlueBubblesClient` from Phase 3 -- add `getConversations()` and `getMessages(chatGuid, offset, limit)` methods.
- **D-07:** Routes stay thin per layered architecture. Route parses query params, calls BB client, returns shaped response.
- **D-08:** Zod validation for query params (offset must be >= 0, limit must be 1-100).
- **D-09:** Error codes from Phase 3 apply here -- `BB_OFFLINE` if BB unreachable, `VALIDATION_ERROR` for bad query params.

### Claude's Discretion
- Exact BB API endpoints for conversations and messages (researcher will verify)
- How to map BB's response format to our cleaner shape
- Whether to add type definitions for BB API responses
- Test structure (unit tests for service methods, integration tests for routes)

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| READ-01 | GET /conversations returns all threads with contact, last message, timestamp, unread count | BB `POST /api/v1/chat/query` with `with: ["lastMessage"]` provides chats with last message. unreadCount not natively available -- return 0. |
| READ-02 | GET /conversations/:id returns full message history for a thread | BB `GET /api/v1/chat/{guid}/message` returns messages with offset/limit/sort. Map to D-02 shape. |
| READ-03 | Conversation history supports pagination (offset/limit) | Both BB endpoints support offset/limit natively with metadata `{ count, total, offset, limit }`. Map to D-05 shape. |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.2.1 | HTTP framework | Already in project, async error handling |
| zod | ^4.3.6 | Query param validation | Already in project, used for D-08 |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| supertest | ^7.2.2 | Route integration tests | Testing GET endpoints |
| vitest | ^4.1.2 | Test runner | Unit + integration tests |

### No New Dependencies
This phase requires zero new packages. All work uses the existing Express routes, Zod validation, and BlueBubblesClient patterns from Phase 3.

## Architecture Patterns

### BlueBubbles API Endpoints to Use

**Conversation List:**
- **Endpoint:** `POST /api/v1/chat/query`
- **Method:** POST (BB uses POST for queries, not GET)
- **Body:** `{ limit, offset, with: ["lastMessage"] }`
- **Response:** `{ status: 200, data: Chat[], metadata: { count, total, offset, limit } }`
- **Chat fields:** `guid`, `chatIdentifier`, `displayName`, `isArchived`, `participants` (array of Handle), `lastMessage` (Message object when `with` includes it)

**Message History:**
- **Endpoint:** `GET /api/v1/chat/{chatGuid}/message`
- **Query params:** `limit`, `offset`, `sort=DESC` (newest first)
- **Response:** `{ status: 200, data: Message[], metadata: { count, total, offset, limit } }`
- **Message fields:** `guid`, `text`, `isFromMe`, `dateCreated` (epoch ms), `handle` (object with `address` field), `attachments`

### BB Response to Our DTO Mapping

**Chat -> Conversation (D-01):**
```typescript
// BB Chat shape (from POST /api/v1/chat/query with lastMessage)
interface BBChat {
  guid: string;                    // -> id
  chatIdentifier: string;         // -> contact (phone number or email)
  displayName: string | null;     // -> contact (fallback display name for groups)
  participants: BBHandle[];       // -> contact (first participant address if chatIdentifier missing)
  lastMessage?: BBMessage;        // -> lastMessage (text), timestamp (dateCreated)
  // NOTE: no unreadCount field exists in BB
}

// Our clean shape
interface Conversation {
  id: string;          // BB guid
  contact: string;     // chatIdentifier or first participant address
  lastMessage: string; // lastMessage.text or ""
  timestamp: string;   // ISO 8601 from lastMessage.dateCreated
  unreadCount: number; // 0 (BB limitation)
}
```

**BB Message -> Message (D-02):**
```typescript
// BB Message shape
interface BBMessage {
  guid: string;                    // -> id
  text: string | null;             // -> body
  isFromMe: boolean;               // -> isFromMe
  dateCreated: number;             // epoch ms -> ISO 8601 timestamp
  handle: { address: string } | null; // -> sender
}

// Our clean shape
interface Message {
  id: string;          // BB guid
  sender: string;      // handle.address or "me"
  body: string;        // text or ""
  timestamp: string;   // ISO 8601 from dateCreated
  isFromMe: boolean;   // direct pass-through
}
```

### Recommended File Structure
```
src/
  services/
    bluebubbles.ts        # ADD: getConversations(), getMessages()
  routes/
    conversations.ts      # NEW: GET /conversations, GET /conversations/:id
    index.ts              # MODIFY: mount conversationsRouter
  types/
    bluebubbles.ts        # NEW: BB API response types (BBChat, BBMessage, etc.)
    api.ts                # NEW: Our API response types (Conversation, Message, PaginatedResponse)
```

### Pattern: Thin Route + Service Method (from send.ts)
```typescript
// Route: parse params, validate, call service, return shaped response
conversationsRouter.get('/conversations', async (req, res) => {
  const { offset, limit } = paginationSchema.parse(req.query);
  const client = getBBClient();
  const result = await client.getConversations(offset, limit);
  res.json(result);
});
```

### Pattern: Zod Query Param Validation (D-08)
```typescript
import { z } from 'zod';

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
```
Note: Query params arrive as strings, so `z.coerce.number()` handles the string-to-number conversion. Values above max (100) should be clamped per D-04 -- use `.transform(v => Math.min(v, 100))` or clamp after parse.

### Pattern: BB Client Method
```typescript
// In BlueBubblesClient class
async getConversations(offset: number, limit: number) {
  // BB uses POST for chat queries
  const data = await this.request<BBChatQueryResponse>('/api/v1/chat/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offset,
      limit,
      with: ['lastMessage'],
    }),
  });
  // NOTE: this.request<T>() currently returns body.data
  // The metadata (total, count) is in body.metadata -- need to adjust
}
```

### Anti-Patterns to Avoid
- **Constructing chatGuids manually for message retrieval:** The `:id` param IS the chatGuid from the conversation list. Pass it directly to BB -- don't parse or reconstruct it.
- **Multiple BB calls per request:** Don't call BB once for chats, then N more times for each chat's last message. Use `with: ["lastMessage"]` in the chat query to get it in one call.
- **Passing BB response directly to client:** Always map through our DTO types. BB responses have dozens of fields Tyler doesn't need.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query param parsing | Manual parseInt + validation | Zod coerce + transform | Edge cases: NaN, negative, floats, empty strings |
| Timestamp conversion | Manual Date math | `new Date(epochMs).toISOString()` | BB returns epoch milliseconds, standard JS handles this |
| Pagination clamping | if/else limit checks | Zod `.default(25).transform(v => Math.min(v, 100))` | Single source of truth for defaults and bounds |

## Common Pitfalls

### Pitfall 1: BlueBubblesClient.request() Only Returns body.data
**What goes wrong:** The existing `request<T>()` method returns `body.data` only. For paginated endpoints, the metadata (`total`, `count`, `offset`, `limit`) is in `body.metadata`, which is discarded.
**Why it happens:** Phase 3 only needed the data payload (sendMessage returns message data). Pagination needs metadata too.
**How to avoid:** Either (a) add a separate `requestWithMeta<T>()` method that returns `{ data: T, metadata }`, or (b) modify `request<T>()` to accept a flag, or (c) add specific methods that call fetch directly and parse both data + metadata. Option (a) is cleanest -- doesn't break existing sendMessage usage.
**Warning signs:** Pagination responses missing `total` field.

### Pitfall 2: BB Chat Query Uses POST, Not GET
**What goes wrong:** Attempting `GET /api/v1/chat` fails or returns unexpected results.
**Why it happens:** BlueBubbles uses POST with a JSON body for chat queries, which is unconventional for a read operation.
**How to avoid:** Use `POST /api/v1/chat/query` with body params `{ offset, limit, with: ["lastMessage"] }`.

### Pitfall 3: BB dateCreated is Epoch Milliseconds, Not ISO String
**What goes wrong:** Passing BB's `dateCreated` directly as `timestamp` in our response gives the client a raw number instead of an ISO date string.
**Why it happens:** BB stores dates as epoch milliseconds internally.
**How to avoid:** Convert with `new Date(dateCreated).toISOString()` in the mapping layer. Handle `null`/`0` timestamps gracefully (return empty string or current time).

### Pitfall 4: BB Message text Can Be null
**What goes wrong:** `message.text` is null for system messages, attachment-only messages, or tapbacks. Returning `null` as `body` violates D-02 which specifies `body: string`.
**Why it happens:** Not all iMessage events have text content.
**How to avoid:** Default to empty string: `text ?? ""`.

### Pitfall 5: unreadCount Not Available from BlueBubbles
**What goes wrong:** D-01 specifies `unreadCount: number` but BB has no such field. Attempting to compute it requires per-chat message queries (N+1 problem).
**Why it happens:** The BB Chat entity has `lastReadMessageTimestamp` but the serializer does not expose unread counts.
**How to avoid:** Return `unreadCount: 0` as documented limitation. The response shape stays consistent with D-01 so Tyler's CRM schema doesn't need to change if this is resolved later.

### Pitfall 6: Query Params Are Always Strings
**What goes wrong:** `req.query.offset` is `string | undefined`, not `number`. Passing it directly to BB produces string values in the request body.
**Why it happens:** Express parses query strings as strings by default.
**How to avoid:** Use `z.coerce.number()` in the Zod schema -- it handles string-to-number conversion.

### Pitfall 7: Chat GUID Contains Semicolons and Special Characters
**What goes wrong:** Chat GUIDs like `iMessage;-;+15551234567` can cause issues in URL path params if not handled properly.
**Why it happens:** Express 5 uses path-to-regexp v8 which is more restrictive.
**How to avoid:** The `:id` route param should capture everything after `/conversations/`. Test with real BB chatGuids containing semicolons and plus signs. Express should handle this fine for path params (they're URL-decoded), but verify.

## Code Examples

### Zod Pagination Schema with Clamping
```typescript
// Source: D-03, D-04, D-08
const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(25)
    .transform((v) => Math.min(v, 100)), // D-04: silently clamp to max 100
});
```

### BB Client: getConversations
```typescript
// Source: BB API POST /api/v1/chat/query
async getConversations(offset: number, limit: number) {
  // Need body.data AND body.metadata -- use requestWithMeta
  const { data, metadata } = await this.requestWithMeta<BBChat[]>(
    '/api/v1/chat/query',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset, limit, with: ['lastMessage'] }),
    }
  );

  return {
    data: data.map(mapBBChatToConversation),
    pagination: { offset, limit, total: metadata.total },
  };
}
```

### BB Client: getMessages
```typescript
// Source: BB API GET /api/v1/chat/{guid}/message
async getMessages(chatGuid: string, offset: number, limit: number) {
  const { data, metadata } = await this.requestWithMeta<BBMessage[]>(
    `/api/v1/chat/${encodeURIComponent(chatGuid)}/message?offset=${offset}&limit=${limit}&sort=DESC`
  );

  return {
    data: data.map(mapBBMessageToMessage),
    pagination: { offset, limit, total: metadata.total },
  };
}
```

### DTO Mapping Functions
```typescript
function mapBBChatToConversation(chat: BBChat): Conversation {
  return {
    id: chat.guid,
    contact: chat.chatIdentifier
      ?? chat.participants?.[0]?.address
      ?? chat.displayName
      ?? 'Unknown',
    lastMessage: chat.lastMessage?.text ?? '',
    timestamp: chat.lastMessage?.dateCreated
      ? new Date(chat.lastMessage.dateCreated).toISOString()
      : '',
    unreadCount: 0, // BB does not provide this field
  };
}

function mapBBMessageToMessage(msg: BBMessage): Message {
  return {
    id: msg.guid,
    sender: msg.isFromMe ? 'me' : (msg.handle?.address ?? 'Unknown'),
    body: msg.text ?? '',
    timestamp: new Date(msg.dateCreated).toISOString(),
    isFromMe: msg.isFromMe,
  };
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-01 | GET /conversations returns threads with contact, lastMessage, timestamp, unreadCount | integration | `npx vitest run src/routes/__tests__/conversations.test.ts -t "conversations list"` | Wave 0 |
| READ-02 | GET /conversations/:id returns message history | integration | `npx vitest run src/routes/__tests__/conversations.test.ts -t "message history"` | Wave 0 |
| READ-03 | Pagination with offset/limit returns correct pages | integration | `npx vitest run src/routes/__tests__/conversations.test.ts -t "pagination"` | Wave 0 |
| READ-01 | BB chat response mapped to Conversation DTO | unit | `npx vitest run src/services/__tests__/bluebubbles.test.ts -t "getConversations"` | Wave 0 |
| READ-02 | BB message response mapped to Message DTO | unit | `npx vitest run src/services/__tests__/bluebubbles.test.ts -t "getMessages"` | Wave 0 |
| D-08 | Zod validates offset >= 0, limit 1-100, clamping | unit | `npx vitest run src/routes/__tests__/conversations.test.ts -t "validation"` | Wave 0 |
| D-09 | BB_OFFLINE error when BB unreachable | integration | `npx vitest run src/routes/__tests__/conversations.test.ts -t "BB_OFFLINE"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/routes/__tests__/conversations.test.ts` -- covers READ-01, READ-02, READ-03, D-08, D-09
- [ ] `src/services/__tests__/bluebubbles.test.ts` -- extend existing tests for getConversations, getMessages mapping

## Open Questions

1. **unreadCount unavailability**
   - What we know: BB Chat entity has `lastReadMessageTimestamp` but serializer does not expose unread count. Computing it server-side requires per-chat message queries (N+1).
   - What's unclear: Whether Tyler's CRM actually uses unreadCount or just displays it.
   - Recommendation: Return `0` with documentation. If Tyler needs real unread counts later, add a follow-up that queries messages after `lastReadMessageTimestamp` per chat (expensive but possible).

2. **Chat GUID URL encoding in path params**
   - What we know: Chat GUIDs contain semicolons (`iMessage;-;+15551234567`). Express 5 path-to-regexp v8 is stricter.
   - What's unclear: Whether Express 5 handles semicolons in `:id` path params correctly without special configuration.
   - Recommendation: Test during implementation. If problematic, use `encodeURIComponent` on the client side and `decodeURIComponent` on the server side. Fallback: accept chatGuid as a query param instead.

3. **request() method needs metadata access**
   - What we know: Current `request<T>()` returns only `body.data`. Pagination requires `body.metadata.total`.
   - What's unclear: Best refactor approach that doesn't break existing sendMessage usage.
   - Recommendation: Add `requestWithMeta<T>()` alongside existing `request<T>()`. Clean separation, no breaking changes.

## Sources

### Primary (HIGH confidence)
- [BlueBubbles Server chatRouter.ts](https://github.com/BlueBubblesApp/bluebubbles-server/blob/master/packages/server/src/server/api/http/api/v1/routers/chatRouter.ts) -- chat query endpoint implementation, `with` parameter, pagination metadata
- [BlueBubbles Server messageRouter.ts](https://github.com/BlueBubblesApp/bluebubbles-server/blob/master/packages/server/src/server/api/http/api/v1/routers/messageRouter.ts) -- message query endpoint, offset/limit/sort params
- [BlueBubbles Server ChatSerializer.ts](https://github.com/BlueBubblesApp/bluebubbles-server/blob/master/packages/server/src/server/api/serializers/ChatSerializer.ts) -- confirmed no unreadCount field in serialized output
- [BlueBubbles Server Chat.ts entity](https://github.com/BlueBubblesApp/bluebubbles-server/blob/master/packages/server/src/server/databases/imessage/entity/Chat.ts) -- confirmed no unread fields in DB entity
- [mautrix-imessage BlueBubbles Go package](https://pkg.go.dev/go.mau.fi/mautrix-imessage/imessage/bluebubbles) -- Chat struct, Message struct, PageMetadata struct

### Secondary (MEDIUM confidence)
- [BlueBubbles API Guide (gist)](https://gist.github.com/hmseeb/e313cd954ad893b75433f2f2db0fb704) -- endpoint summaries, query params, response shapes
- [BlueBubbles REST API docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) -- general API overview, auth method

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns established in Phase 3
- Architecture: HIGH -- BB API endpoints verified against source code, pagination metadata confirmed
- Pitfalls: HIGH -- unreadCount limitation discovered and documented, request() metadata gap identified
- BB API mapping: MEDIUM -- response shapes verified via source code and Go bridge types, but not tested against live BB instance

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable -- BB API unlikely to change without server update, pinned to v1.9.9)
