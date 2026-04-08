---
project: ElkRidge BlueBubbles iMessage API
version: 1.0.0
last_updated: 2026-04-08
description: Production REST API wrapper for BlueBubbles that enables programmatic iMessage send/receive, built for CRM integration at Elk Ridge Investments.
stack: Node.js 20, Express 5, TypeScript 5, Zod 3, pino 9, socket.io-client 4, PM2 5
deployment: Mac Mini (macOS 26.3.1), Cloudflare Tunnel, PM2
domain: bb1.elkbb.dev
---

# ElkRidge BlueBubbles iMessage API — AI Context Document

This document is designed for consumption by AI assistants, MCP servers, and automated tools. It contains everything needed to understand, query, and integrate with this API.

---

## LIVE ENDPOINTS

### Direct BlueBubbles Server

- **Base URL:** `https://bb1.elkbb.dev`
- **Auth:** Query param `password=RedBubble909`
- **Port (local):** 1235

### ElkRidge Wrapper API

- **Base URL:** `http://localhost:3000` (not yet exposed via tunnel)
- **Auth:** Header `Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc`
- **Port (local):** 3000

---

## WRAPPER API REFERENCE

### POST /send

Send an iMessage.

```
POST /send
Authorization: Bearer <API_KEY>
Content-Type: application/json

{"to": "+15551234567", "message": "Hello"}
```

Response: `{"messageId": "uuid", "status": "queued"}`

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| to | string | yes | Phone number, any format (auto-normalized to E.164) |
| message | string | yes | 1-5000 characters |

Errors: `VALIDATION_ERROR` (400), `INVALID_PHONE` (400), `RATE_LIMITED` (429), `BB_OFFLINE` (503), `INTERNAL_ERROR` (500)

Note: "queued" means accepted, not delivered. Delivery confirmation arrives via webhook.

### GET /conversations

List conversation threads.

```
GET /conversations?offset=0&limit=25
Authorization: Bearer <API_KEY>
```

Response:
```json
{
  "data": [{"id": "iMessage;-;+15551234567", "contact": "+15551234567", "lastMessage": "...", "timestamp": "...", "unreadCount": 2}],
  "pagination": {"offset": 0, "limit": 25, "total": 142}
}
```

### GET /conversations/:id

Get messages in a conversation.

```
GET /conversations/iMessage;-;+15551234567?offset=0&limit=25
Authorization: Bearer <API_KEY>
```

Response:
```json
{
  "data": [{"id": "msg-abc", "sender": "+15551234567", "body": "...", "timestamp": "...", "isFromMe": false}],
  "pagination": {"offset": 0, "limit": 25, "total": 87}
}
```

### GET /health

No auth required.

```
GET /health
```

Response: `{"status": "healthy|degraded|down", "bluebubbles": {"status": "connected", "version": "1.9.9"}, "imessage": {"authenticated": true}, "system": {"macosVersion": "26.3.1"}}`

---

## DIRECT BLUEBUBBLES API REFERENCE

All requests require `?password=RedBubble909` as a query parameter.

### Server Info
```
GET /api/v1/server/info?password=<PW>
```

### List Chats
```
GET /api/v1/chat?password=<PW>&limit=10&offset=0&sort=lastmessage&with=lastMessage
```

### Get Messages in Chat
```
GET /api/v1/chat/<CHAT_GUID>/message?password=<PW>&limit=25&offset=0&sort=DESC
```

### Send Message
```
POST /api/v1/message/text?password=<PW>
Content-Type: application/json

{"chatGuid": "iMessage;-;+1XXXXXXXXXX", "tempGuid": "temp-001", "message": "Hello"}
```

### Search Messages
```
POST /api/v1/message/query?password=<PW>
Content-Type: application/json

{"limit": 25, "offset": 0, "sort": "DESC", "where": [{"statement": "message.text LIKE :term", "args": {"term": "%hello%"}}]}
```

### Get Contacts
```
GET /api/v1/contact?password=<PW>
```

---

## WEBHOOK EVENTS

When `CRM_WEBHOOK_URL` is configured, the wrapper POSTs events to your CRM.

### Inbound Message
```json
{"type": "inbound_message", "messageId": "guid", "sender": "+15551234567", "body": "message text", "timestamp": "ISO8601", "threadId": "iMessage;-;+15551234567"}
```

### Delivery Confirmation
```json
{"type": "delivery_confirmation", "messageId": "guid", "status": "delivered|read|unknown", "timestamp": "ISO8601"}
```

Behavior: deduplication (1 webhook per BB event), retry with exponential backoff (5 attempts), backfill on reconnect.

---

## ERROR CODES

| Code | HTTP | Retryable | Meaning |
|------|------|-----------|---------|
| VALIDATION_ERROR | 400 | no | Bad request body or params |
| INVALID_PHONE | 400 | no | Phone number unparseable |
| AUTH_FAILURE | 401 | no | Missing/wrong API key |
| RATE_LIMITED | 429 | yes | Token bucket exhausted |
| INTERNAL_ERROR | 500 | no | Unexpected error |
| SEND_FAILED | 500 | yes | BB accepted but send failed |
| BB_OFFLINE | 503 | yes | BlueBubbles unreachable |
| BB_IMESSAGE_DISCONNECTED | 503 | yes | iMessage signed out |

---

## RATE LIMITING

- **Application layer:** Token bucket, 100 capacity, refills 4 tokens/hour
- **Nginx layer:** 10 req/sec, burst=20
- **Send jitter:** 2-8s normal delay, 30-90s periodic pauses (mimics human pacing)

---

## ENVIRONMENT VARIABLES

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| BLUEBUBBLES_URL | yes | — | BlueBubbles server URL (e.g. http://localhost:1235) |
| BLUEBUBBLES_PASSWORD | yes | — | BlueBubbles server password |
| PORT | no | 3000 | Express listen port |
| NODE_ENV | no | development | development or production |
| API_KEY | prod only | — | Bearer token (min 16 chars) |
| CRM_WEBHOOK_URL | no | — | URL to POST inbound messages to |
| ALERT_WEBHOOK_URL | no | — | URL to POST downtime alerts to |
| RATE_LIMIT_CAPACITY | no | 100 | Token bucket capacity |
| RATE_LIMIT_REFILL_PER_HOUR | no | 4 | Tokens added per hour |
| DEFAULT_COUNTRY_CODE | no | US | For phone number normalization |
| LOG_LEVEL | no | info | pino log level |
| ENABLE_PRETTY_LOGS | no | false | Pretty-print logs (dev only) |
| RETRY_QUEUE_MAX_SIZE | no | 1000 | Max queued webhook retries |
| HEALTH_POLL_INTERVAL_MS | no | 60000 | Health check polling interval |
| ALERT_AFTER_FAILURES | no | 2 | Consecutive failures before alert |

---

## ARCHITECTURE

```
Internet → Cloudflare Tunnel (bb1.elkbb.dev)
              │
              ▼
         Mac Mini (macOS 26.3.1)
              │
              ├─ BlueBubbles Server (port 1235) ← direct API
              │     └─ iMessage ← Tyler's Apple ID (presten@getdavid.ai)
              │
              └─ ElkRidge Wrapper (port 3000) ← simplified API
                    ├─ Express 5 + Zod validation
                    ├─ Token bucket rate limiter
                    ├─ Socket.IO listener (real-time BB events)
                    ├─ Webhook relay → CRM
                    ├─ Retry queue (exponential backoff)
                    ├─ Dedup buffer
                    ├─ Backfill on reconnect
                    └─ Health monitor + alerting
```

### Key Design Decisions

1. **Fire-and-forget send:** POST /send returns immediately with queued status. Actual send happens async with jitter delay to avoid Apple spam detection.
2. **No database:** Only persisted state is `last_synced_at` in a local JSON file. CRM owns all message data.
3. **Singleton services:** BB client, rate limiter, dedup buffer use factory/singleton pattern.
4. **Localhost binding:** Express binds 127.0.0.1 only. Public traffic goes through Cloudflare Tunnel.

---

## FILE STRUCTURE

```
ElkRidge/
  src/
    config/env.ts              — Zod-validated environment config
    middleware/
      auth.ts                  — Bearer token authentication
      error-handler.ts         — Centralized error handling
      request-logger.ts        — Structured request logging (pino)
    routes/
      send.ts                  — POST /send
      conversations.ts         — GET /conversations, /:id
      health.ts                — GET /health
    services/
      bluebubbles.ts           — BlueBubbles REST client
      rate-limiter.ts          — Token bucket with jitter
      webhook-relay.ts         — CRM webhook delivery
      retry-queue.ts           — Exponential backoff retries
      bb-events.ts             — Socket.IO event listener
      health-monitor.ts        — Periodic health polling
      backfill.ts              — Missed message recovery
      dedup.ts                 — Event deduplication
      sync-state.ts            — last_synced_at persistence
    types/
      errors.ts                — AppError class + error codes
      api.ts                   — Request/response DTOs
      bluebubbles.ts           — BB API response types
      webhook.ts               — Webhook payload types
    app.ts                     — Express app factory
    server.ts                  — Entry point
  deploy/
    nginx/bluebubbles-api.conf — Nginx reverse proxy template
  docs/
    API.md                     — Full API reference
    DEPLOYMENT.md              — Deployment guide
    ONBOARDING.md              — Adding phone numbers
    HANDOFF.md                 — Code handoff doc
  ecosystem.config.cjs         — PM2 process config
  .env.example                 — Environment template
  .env.tyler_iphone            — Active production config
```

---

## COMMANDS

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript |
| `npm test` | Run tests (171 passing) |
| `npm run dev` | Dev mode with hot reload |
| `pm2 start ecosystem.config.cjs` | Start production |
| `pm2 logs bb-tyler-iphone` | View logs |
| `pm2 status` | Check process status |
| `cloudflared tunnel info elkbb` | Check tunnel status |

---

## MULTI-INSTANCE SETUP

Each phone number runs as a separate instance:

| Setting | Instance 1 (Tyler) | Instance 2 (TBD) |
|---------|-------------------|-------------------|
| PM2 name | bb-tyler-iphone | bb-instance-2 |
| Env file | .env.tyler_iphone | .env.instance_2 |
| Express port | 3000 | 3001 |
| BB port | 1235 | TBD |
| Subdomain | bb1.elkbb.dev | bb2.elkbb.dev |

To add a new instance: see `docs/ONBOARDING.md`.
