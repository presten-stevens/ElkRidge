# Delivery Status API

**Scope:** Medium | **Depends on:** Core API (complete)

---

## What It Does

Adds a GET endpoint to check whether a sent message was delivered or read, instead of relying solely on webhook events. Send a message, get back an ID, and query that ID later to see its status.

## Why It Matters

Right now, delivery confirmations come through the webhook only. If your CRM misses a webhook or you want to check status on demand (e.g., "did that message actually get delivered?"), there's no way to ask. This gives you a pull-based option alongside the existing push-based webhooks.

## How It Works

When you send a message via POST /send, the API starts tracking its delivery status internally. As BlueBubbles reports delivery and read receipts, the status updates automatically. You can query it anytime using the message ID you got back from the send call.

**Status values:** `sent` → `delivered` → `read` (or `failed` if the send errored)

Status entries are kept for 1 hour by default (configurable), then automatically cleaned up. If you query a message that's expired or was never tracked, you get `status: "unknown"` with a 200 response (not a 404).

## API Example

```bash
# 1. Send a message
curl -X POST https://api.example.com/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to": "+18015551234", "message": "Hello"}'
# → { "messageId": "abc-123", "status": "queued" }

# 2. Check status a few seconds later
curl https://api.example.com/messages/abc-123/status \
  -H "Authorization: Bearer YOUR_API_KEY"
# → { "messageId": "abc-123", "status": "delivered", "updatedAt": "2026-04-03T10:00:05Z" }

# 3. Check again after they open it
curl https://api.example.com/messages/abc-123/status \
  -H "Authorization: Bearer YOUR_API_KEY"
# → { "messageId": "abc-123", "status": "read", "updatedAt": "2026-04-03T10:02:30Z" }
```

## Scope

- 2 development phases (status store first, then route + event wiring)
- 4 tasks total
- Default status TTL: 1 hour (configurable via environment variable)
