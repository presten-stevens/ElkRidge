# Phase 11: Group Chat Support - Research

**Researched:** 2026-04-03
**Domain:** BlueBubbles iMessage API - Group Chat Messaging
**Confidence:** MEDIUM

## Summary

Group chat support in BlueBubbles is structurally similar to 1:1 messaging -- the same REST endpoints and Socket.IO events are used for both. The critical distinction is in the **chat GUID format**: 1:1 chats use `iMessage;-;+1XXXXXXXXXX` (minus sign, phone number) while group chats use `iMessage;+;chat<number>` (plus sign, opaque chat ID). This means group chats cannot be addressed by phone number -- Tyler must use the exact chat GUID obtained from the chat query endpoint or from inbound webhook events. The same `/api/v1/message/text` endpoint sends to groups; only the `chatGuid` field value changes.

The webhook pipeline already receives group messages through the same `new-message` Socket.IO event. The `BBSocketMessage.handle` field identifies the individual sender, and `BBSocketMessage.chats[0].guid` identifies the group. However, the current webhook payload (`InboundMessagePayload`) lacks group-specific fields: there is no `isGroup` flag, no participant list, and no group display name. The conversation endpoints similarly flatten groups and 1:1 threads into the same `Conversation` type without distinguishing them.

**Primary recommendation:** Extend existing types and mappings (not new endpoints) to surface group metadata. Add `isGroup`, `groupName`, and `participants` fields to webhook payloads and conversation responses. Send to groups by accepting the group chat GUID directly in POST /send alongside the existing phone number flow.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EMSG-02 | Group chat support | BB API uses same endpoints for groups; requires type extensions for group metadata, GUID-based addressing for sends, and participant enrichment from chat query |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.1 | HTTP routing | Already in use |
| zod | 4.3.6 | Request validation | Already in use |
| socket.io-client | 4.8.3 | BB event stream | Already in use |

### Supporting
No new dependencies required. Group chat support is achieved entirely through type extensions and mapping logic changes to existing code.

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Changes by Layer

```
src/
  types/
    bluebubbles.ts   # Extend BBChat with groupId; extend BBSocketMessage chats with participants
    webhook.ts        # Add group fields to InboundMessagePayload
    api.ts            # Add group fields to Conversation type
  services/
    bluebubbles.ts    # Update mapBBChatToConversation for group detection; add sendToGroup or extend sendMessage
    webhook-relay.ts  # Update mapInboundMessage to include group metadata
    backfill.ts       # Include threadId (chat guid) from message context
    bb-events.ts      # Enrich group messages with participant data via chat lookup
  routes/
    send.ts           # Accept chatGuid OR phone number (not both); validate group sends
    conversations.ts  # No route changes needed (types flow through)
```

### Pattern 1: Group Detection via Chat GUID Format
**What:** BlueBubbles encodes chat type in the GUID string. `iMessage;+;chat<N>` = group, `iMessage;-;<address>` = 1:1.
**When to use:** Anytime you need to determine if a chat is a group.
**Example:**
```typescript
// Source: BlueBubbles server issue #681, mautrix-imessage Go client
function isGroupChat(chatGuid: string): boolean {
  return chatGuid.includes(';+;');
}
```

### Pattern 2: Dual-Mode Send (Phone or Chat GUID)
**What:** POST /send currently only accepts `to` (phone number). For groups, accept `chatGuid` directly since group chats have opaque IDs, not phone numbers.
**When to use:** Sending to groups.
**Example:**
```typescript
// Extend send schema to accept either phone OR chatGuid
const sendSchema = z.object({
  to: z.string().min(1).optional(),
  chatGuid: z.string().min(1).optional(),
  message: z.string().min(1).max(5000),
}).refine(
  (data) => Boolean(data.to) !== Boolean(data.chatGuid),
  { message: 'Provide either "to" (phone) or "chatGuid" (group), not both' },
);
```

### Pattern 3: Participant Enrichment via Chat Lookup
**What:** Socket.IO `new-message` events include `chats[0].guid` but do NOT include the full participant list. To provide participants in the webhook payload, perform a lightweight chat lookup against the BB API using the chat GUID.
**When to use:** When relaying group messages to the CRM webhook.
**Example:**
```typescript
// Source: BB API /api/v1/chat/:guid
async function getChatDetails(chatGuid: string): Promise<BBChat> {
  return this.request<BBChat>(`/api/v1/chat/${encodeURIComponent(chatGuid)}?with[]=participants`);
}
```

### Anti-Patterns to Avoid
- **Parsing chat GUIDs to extract participant info:** The GUID is opaque beyond the `;+;` vs `;-;` distinction. Never try to parse `chat<N>` to derive members.
- **Creating group chats via API as a feature:** BB requires Private API for `POST /api/v1/chat/new`, and the requirement only asks for sending to existing groups. Keep group creation out of scope.
- **Blocking on participant enrichment for every message:** Cache chat details with a short TTL to avoid hammering the BB API on every group message.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Group detection | String parsing heuristics | `chatGuid.includes(';+;')` | BB convention is stable and documented |
| Chat participant cache | Custom Map + TTL | Simple Map with periodic clear (same pattern as DedupBuffer) | Consistent with existing codebase patterns |
| Group chat creation | Full group management API | Out of scope per EMSG-02 | Requirement is send/receive, not create/manage |

## Common Pitfalls

### Pitfall 1: Backfill Missing threadId
**What goes wrong:** The current `backfill.ts` hardcodes `threadId: ''` because `BBMessage` doesn't include chat context. Group messages backfilled without a threadId lose their group association.
**Why it happens:** The `/api/v1/message` endpoint returns messages without embedded chat GUIDs by default.
**How to avoid:** Use the `with[]=chats` query parameter when fetching messages, or use the per-chat message endpoint (`/api/v1/chat/:guid/message`) which inherently provides the chat context.
**Warning signs:** Backfilled group messages appearing with empty `threadId` in webhook payloads.

### Pitfall 2: Participant Lookup Thundering Herd
**What goes wrong:** A burst of group messages triggers N concurrent chat detail lookups for the same group GUID.
**Why it happens:** Each message event independently calls the BB API for participant info.
**How to avoid:** Cache chat details by GUID with a 5-minute TTL. Use a simple in-memory Map cleared on interval (matches DedupBuffer pattern).
**Warning signs:** BB server logs showing repeated `/api/v1/chat/:guid` requests in bursts.

### Pitfall 3: Breaking 1:1 Message Flow
**What goes wrong:** Adding group fields to webhook payloads or making `to` optional on POST /send breaks Tyler's existing CRM integration.
**Why it happens:** Changing required fields or response shapes in a running system.
**How to avoid:** All new fields (`isGroup`, `groupName`, `participants`) must be additive -- existing fields remain unchanged and populated. The `to` field on POST /send remains valid for 1:1; `chatGuid` is a new alternative field.
**Warning signs:** CRM webhook handler errors on unexpected fields or missing `to` field.

### Pitfall 4: SMS Group vs iMessage Group
**What goes wrong:** SMS/MMS group chats have `SMS;+;chat<N>` GUIDs, not `iMessage;+;chat<N>`. If Tyler's contacts have Android phones mixed in, some groups may be SMS-based.
**Why it happens:** iMessage falls back to SMS for non-Apple participants.
**How to avoid:** Support both service prefixes in group detection. Use `guid.includes(';+;')` rather than `guid.startsWith('iMessage;+;')`.
**Warning signs:** Group messages from mixed Apple/Android groups not being detected as groups.

## Code Examples

### Extended BBChat Type
```typescript
// Source: mautrix-imessage Go client (BB API response shape)
export interface BBChat {
  guid: string;
  chatIdentifier: string;
  displayName: string | null;
  groupId: string | null;         // NEW: non-null for groups
  participants: BBHandle[];
  lastMessage?: BBMessage;
  style?: number;                  // NEW: chat style indicator
  properties?: Array<{
    groupPhotoGuid?: string | null;
  }>;
}
```

### Extended Webhook Payload
```typescript
export interface InboundMessagePayload {
  type: 'inbound_message';
  messageId: string;
  sender: string;
  body: string;
  timestamp: string;
  threadId: string;
  // NEW group fields (all optional for backward compat)
  isGroup?: boolean;
  groupName?: string | null;
  participants?: string[];         // array of addresses
}
```

### Extended Conversation Type
```typescript
export interface Conversation {
  id: string;
  contact: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  // NEW group fields
  isGroup: boolean;
  groupName: string | null;
  participants: string[];
}
```

### Group-Aware Send Logic
```typescript
// In bluebubbles.ts
async sendMessage(chatGuid: string, message: string): Promise<{ guid: string; text: string }> {
  const tempGuid = crypto.randomUUID();
  return this.request<{ guid: string; text: string }>('/api/v1/message/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatGuid,             // Works for both iMessage;-;+1... and iMessage;+;chat...
      tempGuid: `temp-${tempGuid}`,
      message,
    }),
  });
}
```

### Chat Detail Cache
```typescript
// Simple cache following DedupBuffer pattern
class ChatCache {
  private cache = new Map<string, { data: BBChat; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private ttlMs: number = 300_000) { // 5 min default
    this.cleanupTimer = setInterval(() => this.evict(), 60_000);
    this.cleanupTimer.unref();
  }

  get(guid: string): BBChat | undefined {
    const entry = this.cache.get(guid);
    if (!entry || Date.now() > entry.expiresAt) {
      this.cache.delete(guid);
      return undefined;
    }
    return entry.data;
  }

  set(guid: string, data: BBChat): void {
    this.cache.set(guid, { data, expiresAt: Date.now() + this.ttlMs });
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.cache.clear();
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phone-only addressing | Chat GUID addressing for groups | Always (BB convention) | Groups require GUID, not phone list |
| No participant data in webhooks | Enrich via chat detail lookup | Phase 11 addition | CRM gets group context |

## Open Questions

1. **Does BB socket `new-message` event embed full chat with participants?**
   - What we know: The `chats` array in `BBSocketMessage` currently typed as `Array<{ guid: string }>`. The actual BB response may include more fields (participants, displayName) if the socket emits full chat objects.
   - What's unclear: Whether the socket event payload matches the REST API `BBChat` shape or is minimal.
   - Recommendation: Test with a real BB instance. If chats are minimal, use the chat detail lookup with caching. Type the `chats` array generously and handle both cases.

2. **Group chat creation via API**
   - What we know: BB has `POST /api/v1/chat/new` requiring Private API (macOS 11+). Takes `participants` array of addresses.
   - What's unclear: Whether Tyler needs to create groups programmatically or only send to existing ones.
   - Recommendation: Out of scope for EMSG-02. Document as future enhancement. Tyler can create groups via the native Messages app.

3. **Group event webhooks (participant-added, participant-removed, group-name-change)**
   - What we know: BB docs mention these as available webhook event types.
   - What's unclear: Exact payload shapes for these events.
   - Recommendation: Out of scope for initial group support. Can be added incrementally later. Focus on message send/receive first.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | None detected -- vitest uses package.json defaults |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EMSG-02a | POST /send accepts chatGuid for group sends | integration | `npx vitest run src/routes/send.test.ts -t "group"` | No - Wave 0 |
| EMSG-02b | Webhook payload includes isGroup, groupName, participants | unit | `npx vitest run src/services/webhook-relay.test.ts -t "group"` | No - Wave 0 |
| EMSG-02c | GET /conversations distinguishes group from 1:1 | unit | `npx vitest run src/services/bluebubbles.test.ts -t "group"` | No - Wave 0 |
| EMSG-02d | Existing 1:1 flow unaffected (backward compat) | integration | `npx vitest run src/routes/send.test.ts -t "1:1"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Test files for group-specific behavior (new test cases in existing or new test files)
- [ ] Mock BB API responses with group chat shapes for unit tests

## Sources

### Primary (HIGH confidence)
- [BlueBubbles server issue #681](https://github.com/BlueBubblesApp/bluebubbles-server/issues/681) - Chat GUID format: `;-;` = DM, `;+;` = group
- [mautrix-imessage Go client](https://pkg.go.dev/go.mau.fi/mautrix-imessage/imessage/bluebubbles) - Full BB API type definitions (Chat, Message, SendTextRequest, Handle structs)
- [BB setup gist](https://gist.github.com/hmseeb/e313cd954ad893b75433f2f2db0fb704) - Group send format `any;+;chat<id>`, chat query with participants

### Secondary (MEDIUM confidence)
- [BB official docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) - Webhook events include group-name-change, participant-added/removed
- [OpenClaw BB integration](https://docs.openclaw.ai/channels/bluebubbles) - Participant enrichment from contacts, chat GUID addressing patterns

### Tertiary (LOW confidence)
- Socket.IO `new-message` payload shape for groups -- exact fields unverified (only tested Go client struct shape, not live socket output)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, extensions to existing code
- Architecture: MEDIUM - Chat GUID format well-documented, participant enrichment strategy needs live validation
- Pitfalls: MEDIUM - Based on known BB patterns but some group-specific behaviors unverified without live testing

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable -- BB API conventions are mature)
