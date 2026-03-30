# Phase 5: Inbound Webhook Pipeline - Research

**Researched:** 2026-03-30
**Domain:** Real-time event processing (Socket.IO client, deduplication, HTTP webhook relay, file-based state persistence)
**Confidence:** HIGH

## Summary

Phase 5 connects to BlueBubbles Server via Socket.IO to receive real-time iMessage events, deduplicates them (BB fires 2-3 events per message), and relays formatted payloads to Tyler's CRM webhook URL. It also forwards delivery confirmation events (`updated-message`) for messages sent via POST /send, and persists a `last_synced_at` timestamp for Phase 6's backfill feature.

The architecture is four small, focused services: a Socket.IO event listener (`bb-events.ts`), an in-memory dedup buffer (`dedup.ts`), an HTTP webhook relay (`webhook-relay.ts`), and a sync state manager (`sync-state.ts`). These are initialized in `server.ts` after the Express app starts. The only new dependency is `socket.io-client` (v4.8.3) -- everything else uses Node.js built-ins (`node:fs/promises`, `node:path`, `node:os`) and existing project dependencies (`pino` for logging, the existing `env` config).

**Primary recommendation:** Use `socket.io-client` v4.8.3 with BB password passed via the `auth` option. Fire webhooks one-at-a-time (not batched) since message volume is low. Use `Map<string, number>` with 60-second TTL for dedup. Atomic JSON writes via temp-file-then-rename for `last_synced_at`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Connect to BlueBubbles WebSocket on server startup. BB exposes a Socket.IO-compatible WebSocket at `BLUEBUBBLES_URL`.
- **D-02:** Auto-reconnect on disconnect with exponential backoff. Log reconnection attempts.
- **D-03:** Listen for `new-message` events (inbound messages) and `updated-message` events (delivery confirmations for SEND-04).
- **D-04:** In-memory Map with message GUID as key and timestamp as value. TTL of 60 seconds -- if the same GUID arrives within 60s, skip it.
- **D-05:** No persistence needed for dedup buffer -- BB's duplicate events arrive within 1-3 seconds of each other. Buffer resets on restart (acceptable).
- **D-06:** Log when a duplicate is detected and skipped (debug level).
- **D-07:** POST to `CRM_WEBHOOK_URL` (from env, already in schema) with JSON payload.
- **D-08:** Inbound message payload: `{ type: "inbound_message", messageId: string, sender: string, body: string, timestamp: string, threadId: string }`.
- **D-09:** Delivery confirmation payload: `{ type: "delivery_confirmation", messageId: string, status: string, timestamp: string }`.
- **D-10:** If CRM_WEBHOOK_URL is not configured, log a warning and skip relay (don't crash).
- **D-11:** Store in `data/last-synced.json` as `{ lastSyncedAt: "ISO8601" }`. Create `data/` directory if it doesn't exist.
- **D-12:** Update after each successfully processed message (not after each webhook delivery).
- **D-13:** Atomic write: write to temp file, then rename. Prevents corruption on crash.
- **D-14:** Read on startup to initialize. If file doesn't exist, treat as "never synced".
- **D-15:** WebSocket connection logic in `src/services/bb-events.ts`. Dedup buffer in `src/services/dedup.ts`. Webhook relay in `src/services/webhook-relay.ts`. last_synced_at in `src/services/sync-state.ts`.
- **D-16:** Services are initialized in `src/server.ts` after Express app starts -- WebSocket connects, begins listening.
- **D-17:** Error codes: add `WEBHOOK_DELIVERY_FAILED` (retryable) for failed CRM POSTs. Phase 6 handles retry logic.

### Claude's Discretion
- Socket.IO client library choice (socket.io-client vs raw WebSocket)
- Exact BB WebSocket event payload shapes (researcher will verify)
- Whether to batch webhook deliveries or fire one-at-a-time
- Test mocking strategy for WebSocket events

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOOK-01 | Inbound webhook fires to configurable URL on every received message | Socket.IO `new-message` event listener relays to CRM_WEBHOOK_URL via HTTP POST |
| HOOK-02 | Webhook payload includes sender, body, timestamp, and thread ID | BB `new-message` data contains `handle.address`, `text`, `dateCreated`, and `chats[0].guid` -- mapped to D-08 payload |
| HOOK-04 | Message deduplication buffer prevents duplicate webhook fires | In-memory `Map<string, number>` with GUID key and 60s TTL per D-04 |
| HOOK-06 | last_synced_at persisted in local JSON file (no database) | Atomic write to `data/last-synced.json` via temp-file-then-rename per D-11/D-13 |
| SEND-04 | Delivery confirmation tracked via updated-message webhook events | Socket.IO `updated-message` event forwarded as D-09 payload to CRM |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| socket.io-client | 4.8.3 | Connect to BB Socket.IO server | BB uses Socket.IO protocol; raw WebSocket will not work (Socket.IO has its own handshake/framing protocol) |

### Supporting (already in project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 10.3.1 | Structured logging for events, dedup, relay | All services log via existing logger |
| zod | 4.3.6 | Validate BB event payloads before processing | Catch BB API shape changes early |

### Node.js Built-ins Used
| Module | Purpose |
|--------|---------|
| `node:fs/promises` | Atomic write for last-synced.json (writeFile + rename) |
| `node:path` | Path construction for data directory |
| `node:os` | tmpdir for atomic write temp file location |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| socket.io-client | Raw WebSocket | Will NOT work -- BB uses Socket.IO protocol which adds framing, handshake, and reconnection logic on top of WebSocket. Not interchangeable. |
| In-memory Map dedup | Redis/SQLite | Overkill -- duplicates arrive within 1-3 seconds, Map with TTL cleanup is sufficient |
| JSON file for sync state | SQLite | Project constraint: no database. JSON file is correct per requirements. |

**Installation:**
```bash
npm install socket.io-client
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   ├── bb-events.ts          # Socket.IO connection to BB, event listeners
│   ├── dedup.ts              # In-memory GUID dedup buffer with TTL
│   ├── webhook-relay.ts      # HTTP POST to CRM_WEBHOOK_URL
│   └── sync-state.ts         # last_synced_at read/write to JSON file
├── types/
│   ├── error-codes.ts        # Add WEBHOOK_DELIVERY_FAILED
│   └── bluebubbles.ts        # Add BB event payload types
├── server.ts                 # Initialize WebSocket after app.listen()
data/
└── last-synced.json          # Runtime state (gitignored)
```

### Pattern 1: Socket.IO Connection with Auth
**What:** Connect to BB Server using socket.io-client with password authentication
**When to use:** On server startup, after Express app is listening

BlueBubbles Server uses Socket.IO (not raw WebSocket). The server expects the password in the connection handshake. Based on BB's architecture and Socket.IO conventions, the password should be passed via the `auth` option:

```typescript
import { io, Socket } from 'socket.io-client';

const socket = io(env.BLUEBUBBLES_URL, {
  auth: { password: env.BLUEBUBBLES_PASSWORD },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  reconnectionAttempts: Infinity,
});

socket.on('connect', () => {
  logger.info('Connected to BlueBubbles WebSocket');
});

socket.on('disconnect', (reason) => {
  logger.warn({ reason }, 'Disconnected from BlueBubbles WebSocket');
});

socket.on('connect_error', (err) => {
  // Do NOT log err.message directly -- may contain password
  logger.error('BlueBubbles WebSocket connection error');
});
```

**Confidence:** MEDIUM -- BB may use `query` instead of `auth` for the password. If `auth` fails, fall back to:
```typescript
const socket = io(env.BLUEBUBBLES_URL, {
  query: { password: env.BLUEBUBBLES_PASSWORD },
  // ... same reconnection options
});
```

The `query` approach is more likely given BB's older codebase and its use of query-param auth in the REST API. **Try `auth` first, fall back to `query` if handshake fails.**

### Pattern 2: BB Event Payload Shape
**What:** The data structure BB sends for `new-message` and `updated-message` events
**Source:** Verified from mautrix-imessage Go bridge types + BB Python webhook example

BB `new-message` event data contains a message object:
```typescript
// BB sends this as the Socket.IO event payload
interface BBSocketMessage {
  guid: string;
  text: string | null;
  isFromMe: boolean;
  dateCreated: number;       // Unix timestamp in milliseconds
  dateDelivered: number;
  dateRead: number;
  handle: {
    address: string;         // Phone number or email
  } | null;
  chats: Array<{
    guid: string;            // e.g., "iMessage;-;+15551234567"
  }>;
  attachments: Array<{
    guid: string;
    mimeType: string;
    transferName: string;
    totalBytes: number;
  }>;
  associatedMessageGuid: string;
  associatedMessageType: string;
  error: number;
}
```

The webhook format wraps this as `{ type: "new-message", data: BBSocketMessage }`. Socket.IO events may deliver just the data object directly (no wrapper). **Validate with zod at runtime to handle either shape.**

### Pattern 3: In-Memory Dedup with TTL Cleanup
**What:** Map-based dedup buffer with periodic cleanup
**When to use:** Before relaying any event to CRM

```typescript
class DedupBuffer {
  private seen = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private ttlMs: number = 60_000) {
    // Clean up expired entries every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
  }

  isDuplicate(guid: string): boolean {
    const now = Date.now();
    if (this.seen.has(guid)) {
      return true;
    }
    this.seen.set(guid, now);
    return false;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [guid, timestamp] of this.seen) {
      if (timestamp < cutoff) {
        this.seen.delete(guid);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.seen.clear();
  }
}
```

### Pattern 4: Atomic JSON File Write
**What:** Write sync state to temp file, then rename (atomic on POSIX)
**When to use:** After each successfully processed message

```typescript
import { writeFile, rename, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA_DIR = join(process.cwd(), 'data');
const SYNC_FILE = join(DATA_DIR, 'last-synced.json');

async function writeSyncState(lastSyncedAt: string): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tempFile = join(tmpdir(), `last-synced-${Date.now()}.tmp`);
  const content = JSON.stringify({ lastSyncedAt }, null, 2);
  await writeFile(tempFile, content, 'utf-8');
  await rename(tempFile, SYNC_FILE);
}
```

**Important:** `rename()` is atomic only when source and destination are on the same filesystem. Using `os.tmpdir()` may be on a different volume. Safer to write the temp file in the same `data/` directory:
```typescript
const tempFile = join(DATA_DIR, `.last-synced-${Date.now()}.tmp`);
```

### Pattern 5: Webhook Relay with Fetch
**What:** POST transformed event data to CRM_WEBHOOK_URL using Node.js native fetch
**When to use:** After dedup check passes

```typescript
async function relayToCRM(payload: WebhookPayload): Promise<void> {
  if (!env.CRM_WEBHOOK_URL) {
    logger.warn('CRM_WEBHOOK_URL not configured, skipping webhook relay');
    return;
  }

  const response = await fetch(env.CRM_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    logger.error(
      { status: response.status, url: '[CRM_WEBHOOK_URL]' },
      'CRM webhook delivery failed'
    );
    // Phase 6 adds retry logic here. For now, log and continue.
  }
}
```

**Use native `fetch`** (available in Node 24) -- no need for axios. The project already uses native fetch in `BlueBubblesClient`.

### Anti-Patterns to Avoid
- **Logging the full BB Socket.IO URL with password:** The `connect_error` event may contain the URL. Always log a sanitized message.
- **Blocking the event loop in sync state writes:** Always use `fs/promises`, never `fs.writeFileSync`.
- **Constructing chat GUIDs from phone numbers for thread ID:** Use `chats[0].guid` from the BB event data directly.
- **Using `setInterval` without cleanup:** The dedup buffer interval must be cleared on shutdown (graceful shutdown handler).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Socket.IO protocol | Raw WebSocket client | socket.io-client | Socket.IO protocol includes handshake, packet framing, heartbeat, auto-reconnect -- raw WS cannot speak Socket.IO |
| Exponential backoff reconnection | Custom reconnect loop | socket.io-client built-in reconnection | Already handles jitter, max delay, attempt counting |
| HTTP POST to CRM | Custom retry + timeout | Native fetch with AbortSignal.timeout | Simple for Phase 5; Phase 6 adds retry queue |

**Key insight:** socket.io-client handles all the hard parts of maintaining a persistent connection (reconnection with backoff, heartbeat, transport upgrade). The dedup buffer and webhook relay are simple enough to hand-roll.

## Common Pitfalls

### Pitfall 1: BB Sends 2-3 Duplicate Events Per Message
**What goes wrong:** Without dedup, Tyler's CRM receives the same message 2-3 times.
**Why it happens:** BlueBubbles polls the Messages.app database and may detect the same message across multiple poll cycles.
**How to avoid:** Dedup buffer with GUID key and 60s TTL (D-04). Check GUID before any processing.
**Warning signs:** CRM reports duplicate messages. Log duplicate detections at debug level (D-06).

### Pitfall 2: Socket.IO Auth Method Uncertainty
**What goes wrong:** Connection fails silently or BB rejects the handshake.
**Why it happens:** BB documentation doesn't clearly specify whether auth uses `auth` option or `query` parameter. The REST API uses query-param auth, suggesting Socket.IO may too.
**How to avoid:** Try `auth: { password }` first. If `connect_error` fires immediately, try `query: { password }`. Log which method succeeded.
**Warning signs:** Repeated `connect_error` events immediately after connect attempt.

### Pitfall 3: Temp File on Different Filesystem
**What goes wrong:** `rename()` fails with EXDEV (cross-device link) error.
**Why it happens:** `os.tmpdir()` returns `/tmp` on macOS, which may be a different volume than the project's `data/` directory.
**How to avoid:** Write temp file in the same `data/` directory as the target file.
**Warning signs:** EXDEV error in logs during sync state write.

### Pitfall 4: BB Password Leaking in Socket.IO Error Logs
**What goes wrong:** socket.io-client includes connection URL in error messages, which may contain the password.
**Why it happens:** If password is passed via `query`, it's part of the URL string.
**How to avoid:** Never log socket error objects directly. Log only sanitized messages. Prefer `auth` over `query` to keep password out of URLs.
**Warning signs:** Grep logs for the BB password string.

### Pitfall 5: Forgetting to Filter isFromMe Messages
**What goes wrong:** Messages sent BY our service via POST /send trigger `new-message` events back to us, creating a feedback loop of unnecessary webhook fires.
**Why it happens:** BB emits `new-message` for ALL messages, including outbound ones sent by the user/API.
**How to avoid:** Check `isFromMe` field. Only relay messages where `isFromMe === false` as inbound messages.
**Warning signs:** CRM receives webhook for messages it just sent.

### Pitfall 6: Dedup Interval Timer Preventing Graceful Shutdown
**What goes wrong:** Node.js process won't exit because `setInterval` keeps the event loop alive.
**Why it happens:** The dedup cleanup interval is never cleared.
**How to avoid:** Implement `destroy()` method on DedupBuffer. Call it during graceful shutdown. Use `unref()` on the interval if shutdown handling isn't yet implemented.
**Warning signs:** Process hangs on SIGTERM.

## Code Examples

### BB Event Type Mapping to CRM Payload

```typescript
// Map BB new-message event to CRM inbound_message payload (D-08)
function mapInboundMessage(data: BBSocketMessage): InboundMessagePayload {
  return {
    type: 'inbound_message',
    messageId: data.guid,
    sender: data.handle?.address ?? 'Unknown',
    body: data.text ?? '',
    timestamp: new Date(data.dateCreated).toISOString(),
    threadId: data.chats?.[0]?.guid ?? '',
  };
}

// Map BB updated-message event to CRM delivery_confirmation payload (D-09)
function mapDeliveryConfirmation(data: BBSocketMessage): DeliveryConfirmationPayload {
  let status = 'unknown';
  if (data.dateRead) status = 'read';
  else if (data.dateDelivered) status = 'delivered';

  return {
    type: 'delivery_confirmation',
    messageId: data.guid,
    status,
    timestamp: new Date(data.dateDelivered || data.dateRead || data.dateCreated).toISOString(),
  };
}
```

### Error Code Extension

```typescript
// Add to src/types/error-codes.ts
export const ERROR_CODES = {
  // ... existing codes
  WEBHOOK_DELIVERY_FAILED: 'WEBHOOK_DELIVERY_FAILED',
} as const;
```

### Server.ts Integration Point

```typescript
// In src/server.ts, after app.listen():
app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');

  // Initialize WebSocket event pipeline
  initBBEvents();  // Connects Socket.IO, sets up event listeners
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| socket.io-client v2 (callbacks) | socket.io-client v4 (Promise-based, TypeScript native) | 2021 (v4.0) | Typed events, better reconnection, ESM support |
| axios for HTTP POST | Native fetch (Node 18+) | 2023 | Zero dependency for webhook relay |
| dotenv for env vars | Node 24 --env-file | 2024 | Already used in this project |

## Open Questions

1. **BB Socket.IO Auth Method**
   - What we know: BB REST API uses query-param auth (`?password=xxx`). Socket.IO supports both `auth` and `query` options.
   - What's unclear: Which method BB Server expects for Socket.IO connections.
   - Recommendation: Try `auth: { password }` first, fall back to `query: { password }`. Log which succeeds. Both are trivial to implement.

2. **BB Socket.IO Event Wrapper Format**
   - What we know: BB webhooks send `{ type: "new-message", data: {...} }`. Socket.IO events may use the event name as the type and send just the data object.
   - What's unclear: Whether Socket.IO events have the same wrapper or deliver raw message objects.
   - Recommendation: Use zod to validate at runtime. Support both shapes with a union schema.

3. **updated-message Delivery Status Fields**
   - What we know: BB Message type has `dateDelivered` and `dateRead` fields. `updated-message` fires when these change.
   - What's unclear: Exact trigger conditions -- does it fire once for delivered and again for read?
   - Recommendation: Map status from whichever date field is newly populated. Handle both events idempotently.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOOK-01 | new-message event triggers webhook POST to CRM_WEBHOOK_URL | unit | `npx vitest run src/services/__tests__/bb-events.test.ts -t "relays inbound"` | Wave 0 |
| HOOK-02 | Payload includes sender, body, timestamp, threadId | unit | `npx vitest run src/services/__tests__/webhook-relay.test.ts -t "payload"` | Wave 0 |
| HOOK-04 | Duplicate GUID within 60s is skipped | unit | `npx vitest run src/services/__tests__/dedup.test.ts` | Wave 0 |
| HOOK-06 | last_synced_at written to data/last-synced.json | unit | `npx vitest run src/services/__tests__/sync-state.test.ts` | Wave 0 |
| SEND-04 | updated-message event relayed as delivery_confirmation | unit | `npx vitest run src/services/__tests__/bb-events.test.ts -t "delivery"` | Wave 0 |

### Test Mocking Strategy
- **Socket.IO:** Mock `socket.io-client` module. Export a factory function from `bb-events.ts` that accepts a socket instance (dependency injection) so tests can pass a mock.
- **Fetch for webhook relay:** Use `vi.spyOn(globalThis, 'fetch')` to mock native fetch. Already a pattern used elsewhere in the project.
- **File system for sync state:** Use `vi.mock('node:fs/promises')` to avoid real file I/O in tests. Or use a temp directory via `node:os.tmpdir()`.

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/bb-events.test.ts` -- covers HOOK-01, SEND-04
- [ ] `src/services/__tests__/dedup.test.ts` -- covers HOOK-04
- [ ] `src/services/__tests__/webhook-relay.test.ts` -- covers HOOK-02
- [ ] `src/services/__tests__/sync-state.test.ts` -- covers HOOK-06

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 24.3.0 | -- |
| socket.io-client | BB WebSocket | No (not yet installed) | 4.8.3 (npm) | Install via npm |
| Native fetch | Webhook relay | Yes | Built into Node 24 | -- |
| node:fs/promises | Sync state persistence | Yes | Built into Node 24 | -- |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:**
- socket.io-client: Not yet installed. `npm install socket.io-client` required.

## Gitignore Update

Add `data/` to `.gitignore` to prevent `last-synced.json` from being committed:
```
data/
```

## Sources

### Primary (HIGH confidence)
- [mautrix-imessage BlueBubbles types](https://pkg.go.dev/go.mau.fi/mautrix-imessage/imessage/bluebubbles) -- BB message payload structure, event type constants
- [Socket.IO v4 Client API](https://socket.io/docs/v4/client-api/) -- Connection options, auth, reconnection
- [Socket.IO v4 Client Options](https://socket.io/docs/v4/client-options/) -- query vs auth, transport settings
- [BB REST API & Webhooks docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) -- Webhook event types, payload format
- [BB Python Webhook Example](https://docs.bluebubbles.app/server/developer-guides/simple-web-server-for-webhooks/python-web-server) -- Event type field, isFromMe filter
- [BB Server Events source](https://github.com/BlueBubblesApp/bluebubbles-server/blob/master/packages/server/src/server/events.ts) -- All event type constants

### Secondary (MEDIUM confidence)
- [socket.io-client npm](https://www.npmjs.com/package/socket.io-client) -- v4.8.3 confirmed current
- [BB Setup & API Gist](https://gist.github.com/hmseeb/e313cd954ad893b75433f2f2db0fb704) -- Webhook payload example

### Tertiary (LOW confidence)
- BB Socket.IO auth method (query vs auth) -- no official documentation found; inferred from REST API pattern and Socket.IO conventions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- socket.io-client is the only correct choice for BB's Socket.IO protocol
- Architecture: HIGH -- four focused services with clear boundaries, follows existing project patterns
- Pitfalls: HIGH -- duplicate events and isFromMe filter are well-documented; auth method is MEDIUM confidence
- BB event payload: MEDIUM -- verified from mautrix bridge types and webhook docs, but Socket.IO delivery shape needs runtime validation

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable domain, socket.io-client is mature)
