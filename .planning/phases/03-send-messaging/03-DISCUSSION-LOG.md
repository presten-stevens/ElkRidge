# Phase 3: Send Messaging - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 03-send-messaging
**Areas discussed:** Error code taxonomy, Rate limiting strategy, BlueBubbles API client

---

## Error Code Taxonomy

| Option | Description | Selected |
|--------|-------------|----------|
| Flat codes + retryable | SCREAMING_SNAKE codes with retryable: boolean field. Tyler's CRM can switch on code AND auto-decide retries. | ✓ |
| Flat codes only | Same codes but no retryable field. Tyler hardcodes which errors to retry. | |
| HTTP status-aligned (RFC 9457) | Lean on HTTP status codes with Problem Details shape. Standards-compliant but overkill for private API. | |

**User's choice:** Flat codes + retryable (Recommended)
**Notes:** None -- immediate selection.

---

## Rate Limiting Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Token bucket + jitter | 100 token capacity, refills ~4/hr. Absorbs CRM bursts, rejects when empty. Jitter makes sends look organic. | ✓ |
| Sliding window + drip queue | Rolling 24h counter. Queues excess sends instead of rejecting. Risk: unbounded queue growth. | |
| Simple delay per send | Fixed delay + jitter between each send. No burst capacity. | |

**User's choice:** Token bucket + jitter (Recommended)
**Notes:** None -- immediate selection.

---

## BlueBubbles API Client

| Option | Description | Selected |
|--------|-------------|----------|
| Shared service class | BlueBubblesClient in src/services/bluebubbles.ts. Centralizes URL/password, offline detection, typed responses. | ✓ |
| Direct fetch per route | Each route handler makes its own fetch call. Simpler now but duplicates logic. | |

**User's choice:** Shared service class (Recommended)
**Notes:** None -- immediate selection.

---

## Claude's Discretion

- Native fetch vs undici for BB API calls
- Token bucket implementation details
- Test structure for send endpoint
- Retry-After header on 429 responses

## Deferred Ideas

None -- discussion stayed within phase scope.
