# BlueBubbles iMessage API -- Project Report

**Prepared for:** Tyler, Elk Ridge Investments
**Prepared by:** Presten Stevens, DAVID AI
**Date:** April 3, 2026

---

## 1. Executive Summary

This project delivers a production-ready REST API that wraps the BlueBubbles iMessage server, giving you programmatic control over iMessage send and receive capabilities. The API is purpose-built for integration with your CRM workflow.

**What it does:**

- Send iMessages to any phone number via a simple HTTP POST
- Read conversation threads and message history
- Automatically forward inbound iMessages to your CRM via webhook
- Track delivery confirmations (delivered/read status)
- Monitor system health and alert you to downtime

**Current state:** The system is complete, tested (171 passing tests across 18 test files), documented, and ready for production deployment on AWS EC2 Mac hardware. All planned phases (01 through 09) have been executed and verified.

**Tech stack:** Node.js 20, Express 5, TypeScript, Zod validation, pino structured logging, Socket.IO for real-time events, PM2 for process management, nginx for HTTPS/reverse proxy.

---

## 2. Architecture Overview

### High-Level Data Flow

```
Your CRM / Client App
        |
        | HTTPS (Bearer token auth)
        v
   [ nginx reverse proxy ]
   (SSL termination, rate limiting, security headers)
        |
        | HTTP (localhost only)
        v
   [ Express API Server ]
   (auth, validation, rate limiting, routing)
        |
        v
   [ BlueBubbles Server ]  <----->  [ iMessage / macOS ]
        |
        | Socket.IO (real-time events)
        v
   [ Webhook Relay ]  --->  [ Your CRM Webhook Endpoint ]
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **Express App** | `src/app.ts` | HTTP framework with middleware pipeline: helmet, JSON parsing, logging, auth, routing, error handling |
| **Server Entry** | `src/server.ts` | Starts Express on `127.0.0.1`, initializes webhook relay, Socket.IO listener, backfill, and health monitor |
| **BlueBubbles Client** | `src/services/bluebubbles.ts` | HTTP client for BlueBubbles REST API (send messages, fetch conversations, fetch messages, server info) |
| **Socket.IO Listener** | `src/services/bb-events.ts` | Listens for real-time `new-message` and `updated-message` events from BlueBubbles |
| **Webhook Relay** | `src/services/webhook-relay.ts` | Maps BlueBubbles events to clean webhook payloads and POSTs them to your CRM |
| **Retry Queue** | `src/services/retry-queue.ts` | Exponential backoff retry for failed webhook deliveries (up to 5 attempts) |
| **Dedup Buffer** | `src/services/dedup.ts` | Prevents duplicate webhook fires (BlueBubbles often sends 2-3 events per message) |
| **Backfill Service** | `src/services/backfill.ts` | On startup/reconnect, queries BlueBubbles for any messages missed during downtime |
| **Sync State** | `src/services/sync-state.ts` | Persists `last_synced_at` timestamp to local file using atomic writes |
| **Health Check** | `src/services/health.ts` | Queries BlueBubbles server info to determine healthy/degraded/down status |
| **Health Monitor** | `src/services/health-monitor.ts` | Periodic polling with consecutive-failure alerting to your alert webhook |
| **Rate Limiter** | `src/services/rate-limiter.ts` | Token bucket rate limiter with human-like jitter on outbound messages |
| **Auth Middleware** | `src/middleware/auth.ts` | Bearer token authentication (required in production) |
| **Error Handler** | `src/middleware/error-handler.ts` | Centralized error handling with credential redaction on 500+ errors |
| **Logger** | `src/middleware/logger.ts` | Structured JSON logging via pino with automatic redaction of passwords and auth headers |

### Design Principles

- **No database.** The only persisted state is a single `last_synced_at` JSON file. Your CRM is the system of record for all messages.
- **Singleton services.** The BlueBubbles client, rate limiter, and dedup buffer are each instantiated once and shared across the application.
- **Express binds to 127.0.0.1 only.** All public traffic goes through nginx. The Express server is never directly exposed to the internet.
- **Env-based configuration.** Every configurable value is driven by environment variables, validated at startup with Zod. Invalid config causes an immediate, clear failure.

---

## 3. API Capabilities

### POST /send

Send an iMessage to any phone number.

- Accepts phone numbers in any format (parentheses, dashes, spaces, international) -- automatically normalized to E.164
- Returns immediately with a `messageId` and `status: "queued"`
- Actual send happens asynchronously with randomized jitter delay (2-8 seconds, with occasional 30-90 second pauses) to avoid Apple spam detection
- Rate limited via token bucket (default: 100 messages, refills 4/hour)

### GET /conversations

List all conversation threads with the last message and timestamp. Paginated with `offset` and `limit` (max 100 per page).

### GET /conversations/:id

Retrieve the full message history for a specific conversation thread. Paginated, sorted newest-first.

### GET /health

Public endpoint (no auth required). Returns a structured health report:

- **healthy** -- BlueBubbles connected, iMessage authenticated
- **degraded** -- BlueBubbles connected but iMessage not authenticated
- **down** -- BlueBubbles server unreachable

Includes BlueBubbles version, macOS version, and last-checked timestamp.

### Webhook Events (Outbound to Your CRM)

When `CRM_WEBHOOK_URL` is configured, the API automatically forwards:

- **Inbound messages** -- type `inbound_message` with sender, body, timestamp, threadId
- **Delivery confirmations** -- type `delivery_confirmation` with status (delivered/read/unknown)

### Error Response Format

All errors return a consistent structure:

```json
{
  "error": {
    "message": "Human-readable description",
    "code": "MACHINE_READABLE_CODE",
    "retryable": true
  }
}
```

The `retryable` field tells your CRM whether it should retry the request. Error codes include: `VALIDATION_ERROR`, `INVALID_PHONE`, `AUTH_FAILURE`, `RATE_LIMITED`, `BB_OFFLINE`, `SEND_FAILED`, `INTERNAL_ERROR`.

For 500+ errors, the `message` field always returns `"Internal server error"` -- raw error details are never exposed to clients.

---

## 4. Reliability and Resilience

### Webhook Retry Queue

Failed webhook deliveries (CRM endpoint down, network error, non-2xx response) are automatically enqueued for retry:

- Exponential backoff with jitter (1s, 2s, 4s, 8s... up to 60s cap)
- Maximum 5 retry attempts per message
- Queue bounded to 1000 entries (configurable) to prevent unbounded memory growth
- Oldest entries are dropped when the queue is full (with a logged warning)

### Message Backfill

When the service starts or reconnects to BlueBubbles after a disconnect:

1. Reads `last_synced_at` from local file
2. Queries BlueBubbles for all messages since that timestamp
3. Deduplicates against the in-memory buffer
4. Relays missed messages to your CRM webhook
5. Updates `last_synced_at` after each successful relay

This ensures no inbound messages are lost during downtime or restarts.

### Deduplication

BlueBubbles frequently fires 2-3 Socket.IO events per message. The dedup buffer tracks message GUIDs with a 60-second TTL, ensuring each message triggers exactly one webhook to your CRM. The buffer self-cleans every 30 seconds.

### Health Monitoring and Alerting

A background health monitor polls BlueBubbles on a configurable interval (default: 60 seconds):

- Tracks consecutive failures
- Fires a `downtime_alert` webhook to `ALERT_WEBHOOK_URL` after the configured threshold (default: 2 consecutive failures)
- Distinguishes between `bluebubbles` down (server unreachable) and `imessage` degraded (server up but iMessage disconnected)
- Alert fires once per incident -- does not spam. Resets after recovery.

### Sync State Persistence

The `last_synced_at` timestamp uses atomic temp-file-then-rename writes to prevent corruption from crashes or power loss.

### Socket.IO Auto-Reconnect

The BlueBubbles Socket.IO connection is configured with:

- Automatic reconnection enabled
- Reconnection delay: 1s initial, 30s maximum
- Infinite reconnection attempts
- Backfill triggered on every reconnect

---

## 5. Security

### Authentication

- All API endpoints except `/health` require a Bearer token in the `Authorization` header
- API key is configured via the `API_KEY` environment variable (minimum 16 characters)
- API key is **required** when `NODE_ENV=production` -- the server will not start without one
- In development mode, API key is optional (auth is bypassed with a logged warning)

### Credential Protection

- Passwords and auth headers are automatically redacted from all log output (pino redact paths)
- Error responses for 500+ status codes never expose internal error messages -- always return generic `"Internal server error"`
- BlueBubbles password in URLs is never logged on connection failures
- Socket.IO connection errors are logged without the error object to prevent credential leaks

### HTTPS and Nginx

- Express binds to `127.0.0.1` only -- not accessible from the network
- nginx handles all public traffic with HTTPS/SSL (Let's Encrypt via certbot)
- HTTP-to-HTTPS redirect configured
- Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
- helmet middleware adds additional security headers at the Express level
- nginx rate limiting: 10 requests/second per IP with burst of 20 (defense in depth behind the app-level token bucket)

### Request Validation

- All request bodies and query parameters are validated with Zod schemas
- Phone numbers are validated and normalized via `libphonenumber-js`
- All environment variables are validated at startup -- invalid config causes immediate exit with clear error messages

---

## 6. Infrastructure

### PM2 Process Management

- `ecosystem.config.js` defines named PM2 processes per phone number
- Auto-restart on crash (up to 10 restarts with 1-second delay)
- Memory limit: 256MB per process (auto-restart if exceeded)
- `deploy/pm2-startup.sh` configures PM2 to survive macOS reboots via launchd
- Multiple phone numbers run as separate PM2 processes with separate env files and ports

### Deployment Model

- Designed for AWS EC2 Mac instances (mac1.metal or mac2.metal on Dedicated Host)
- Full deployment walkthrough provided in `docs/DEPLOYMENT.md`
- New phone number onboarding checklist in `docs/ONBOARDING.md`

### Multi-Instance Architecture

Each phone number runs as an independent instance:

| Aspect | Per Instance |
|--------|-------------|
| PM2 process name | Unique (e.g., `bb-tyler-iphone`) |
| Environment file | Unique (e.g., `.env.tyler_iphone`) |
| Express port | Unique (e.g., 3000, 3001) |
| Nginx server block | Unique domain/subdomain |
| BlueBubbles server | Unique URL/port |

---

## 7. Test Coverage

**171 tests across 18 test files. All passing.**

Test framework: Vitest with supertest for HTTP integration tests.

### Test Breakdown by Area

| Area | Test File | Tests | What's Covered |
|------|-----------|-------|----------------|
| **Send endpoint** | `routes/send.test.ts` | 11 | Valid send, phone normalization, missing fields, invalid phone, rate limiting, fire-and-forget behavior, error response shapes |
| **Conversations endpoint** | `routes/conversations.test.ts` | 15 | List conversations, message history, pagination, limit clamping, validation errors, BB offline handling |
| **Health endpoint** | `routes/health.test.ts` | 4 | Healthy/degraded/down states, response shape validation |
| **BlueBubbles client** | `services/bluebubbles.test.ts` | 16 | Send message API call format, error handling (BB offline, send failed), password leak prevention, conversation/message mapping, pagination metadata, null handling |
| **Socket.IO events** | `services/bb-events.test.ts` | 14 | Socket connection setup, reconnect config, new-message processing pipeline, updated-message delivery confirmations, duplicate filtering, error resilience, reconnect backfill, shutdown cleanup |
| **Webhook relay** | `services/webhook-relay.test.ts` | 15 | Inbound message mapping, delivery confirmation mapping, CRM relay success/failure, timeout handling, retry queue integration, init/shutdown lifecycle |
| **Backfill** | `services/backfill.test.ts` | 8 | Skip when no sync state, epoch conversion, inbound message relay, outbound message filtering, dedup integration, sync state updates, pagination, empty page handling |
| **Dedup buffer** | `services/dedup.test.ts` | 6 | First-seen detection, duplicate detection within TTL, TTL expiry, cross-GUID independence, cleanup of expired entries, destroy |
| **Health check** | `services/health.test.ts` | 7 | Healthy/degraded/down detection, version field mapping, timestamp, lastChecked, BB connection status |
| **Health monitor** | `services/health-monitor.test.ts` | 8 | Interval polling, alert threshold, service identification (bluebubbles vs imessage), no re-alert after threshold, recovery-then-failure re-alerting, failure counter reset, missing webhook URL, alert POST failure resilience |
| **Rate limiter** | `services/rate-limiter.test.ts` | 5 | Full capacity start, token consumption, exhaustion rejection, time-based refill, jitter ranges (normal and long pause) |
| **Retry queue** | `services/retry-queue.test.ts` | 5 | Enqueue/size, max-size eviction with warning, successful delivery removal, retry attempts on failure, exhaustion with error log |
| **Sync state** | `services/sync-state.test.ts` | 4 | Write with atomic rename, directory creation, read from file, ENOENT handling |
| **Auth middleware** | `middleware/auth.test.ts` | 7 | Valid token, missing header, wrong token, malformed header, dev mode bypass, production API_KEY requirement |
| **Error handler** | `middleware/error-handler.test.ts` | 7 | Credential safety, structured response format, password leak prevention, AppError status codes, retryable flags, generic 500 for unknown errors |
| **Logger** | `middleware/logger.test.ts` | 2 | Password redaction, nested credential redaction |
| **Env config** | `config/env.test.ts` | 6 | Type parsing/transformation, required field validation, defaults, boolean coercion |
| **Phone normalization** | `utils/phone.test.ts` | 5 | US format normalization, international E.164, bare digits, invalid input, empty string |

### Test Approach

- **Unit tests** for all services and utilities with mocked dependencies
- **Integration tests** for route handlers using supertest against the full Express app
- **Security-focused tests** specifically verifying credential redaction and error message safety
- **Edge case coverage** for null values, empty strings, missing fields, and network failures
- All tests run in under 1 second

---

## 8. Documentation Delivered

| Document | Location | Description |
|----------|----------|-------------|
| **README** | `README.md` | Quick start, endpoint summary, project structure, tech stack |
| **API Reference** | `docs/API.md` | Complete endpoint documentation with request/response formats, error codes, webhook event schemas, curl examples, rate limiting details |
| **Deployment Guide** | `docs/DEPLOYMENT.md` | Full AWS EC2 Mac walkthrough: instance launch, macOS config, Node.js install, BlueBubbles setup, app deploy, PM2 config, nginx + SSL, production verification, ongoing maintenance |
| **Onboarding Guide** | `docs/ONBOARDING.md` | Step-by-step checklist for adding a new phone number (BlueBubbles setup, env file, PM2 entry, nginx config, SSL, verification, troubleshooting) |
| **Source Code Handoff** | `docs/HANDOFF.md` | Repository structure, build/test/run commands, key architecture decisions explained, tech stack with versions, contact info |
| **Environment Template** | `.env.example` | Every environment variable documented with defaults and descriptions |
| **Nginx Config Template** | `deploy/nginx/bluebubbles-api.conf` | Ready-to-use nginx config with placeholders and installation instructions for both macOS and Linux |
| **PM2 Startup Script** | `deploy/pm2-startup.sh` | One-command PM2 reboot persistence setup |

---

## 9. Known Limitations and Future Considerations

### Current Limitations

1. **No MMS/attachment support.** The API handles text messages only. BlueBubbles supports attachments, but the wrapper does not currently forward or send them. The attachment metadata exists in the Socket.IO event types (the `attachments` field is defined in `BBSocketMessage`) but is not processed.

2. **No group chat support.** The API treats all conversations as 1:1 threads. Group chat messages will still be relayed via webhook, but there is no endpoint to send to a group or manage group membership.

3. **Unread count is always 0.** The `unreadCount` field in conversation listings is hardcoded to 0 because BlueBubbles does not expose this data through its API.

4. **In-memory retry queue.** The webhook retry queue lives in memory. If the process restarts, queued retries are lost. In practice this is mitigated by the backfill service (which re-discovers and relays missed messages on restart), but a small window of messages could be lost if the CRM was down AND the process restarted simultaneously.

5. **No delivery status tracking via API.** Delivery confirmations are forwarded to your CRM via webhook, but there is no API endpoint to query the delivery status of a sent message. Your CRM needs to track this from the webhook events.

6. **Single-tenant design.** Each API instance serves one phone number. Scaling to many numbers means many PM2 processes, each with their own port and nginx config. This is manageable for a handful of numbers but would need rethinking for 20+.

7. **No message queuing for outbound.** If BlueBubbles is down when you call POST /send, the message is lost (the async send fails silently with a log). There is no outbound retry queue. The `status: "queued"` response does not guarantee delivery.

### Future Considerations

- **Attachment support** could be added by extending the webhook relay to include attachment metadata and adding a POST /send/attachment endpoint.
- **Persistent retry queue** (e.g., SQLite or file-based) would eliminate the restart window for webhook retries.
- **Outbound message retry** would add resilience for sends when BlueBubbles is temporarily down.
- **Webhook signature verification** (HMAC) would let your CRM verify that webhook payloads genuinely came from this API.
- **Rate limit headers** (X-RateLimit-Remaining, X-RateLimit-Reset) would help your CRM client manage its request rate.

---

## 10. Handoff Checklist

This is what you need to do to take full ownership and operate the system.

### Before Going Live

- [ ] **Provision AWS EC2 Mac instance** following `docs/DEPLOYMENT.md`
- [ ] **Install and configure BlueBubbles Server** on the Mac instance
- [ ] **Sign into iMessage** with the Apple ID for the target phone number
- [ ] **Verify BlueBubbles** is working: `curl http://localhost:1234/api/v1/server/info?password=YOUR_BB_PASSWORD`
- [ ] **Clone the repository** to the Mac instance
- [ ] **Create `.env.tyler_iphone`** from `.env.example` with production values
- [ ] **Generate a strong API key:** `openssl rand -hex 32`
- [ ] **Set `CRM_WEBHOOK_URL`** to your CRM's inbound webhook endpoint
- [ ] **Set `ALERT_WEBHOOK_URL`** to wherever you want downtime alerts sent
- [ ] **Build:** `npm run build`
- [ ] **Run tests:** `npm test` (all 171 should pass)
- [ ] **Start with PM2:** `pm2 start ecosystem.config.js`
- [ ] **Configure PM2 reboot persistence:** `bash deploy/pm2-startup.sh`
- [ ] **Set up nginx + SSL** following `docs/DEPLOYMENT.md` sections 8-9
- [ ] **Verify health:** `curl https://YOUR_DOMAIN/health`
- [ ] **Send a test message:** `curl -X POST https://YOUR_DOMAIN/send -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"to": "+1YOURNUMBER", "message": "Test from production"}'`
- [ ] **Verify webhook delivery** by checking your CRM received an inbound_message event when you reply to the test message

### Ongoing Operations

- [ ] **Monitor health** via the `/health` endpoint or your alert webhook
- [ ] **Check PM2 status** periodically: `pm2 status`
- [ ] **Review logs** if issues arise: `pm2 logs bb-tyler-iphone`
- [ ] **Renew SSL certificates** (automatic via certbot, but verify with `sudo certbot renew --dry-run`)
- [ ] **Pin BlueBubbles version** -- test updates on a separate machine before upgrading production

### Adding a New Phone Number

Follow the step-by-step checklist in `docs/ONBOARDING.md`. Each number needs its own BlueBubbles instance, env file, PM2 process, port, and nginx server block.

### Key Files You'll Touch

| Task | File |
|------|------|
| Change env config | `.env.tyler_iphone` (or your named env file) |
| Add a phone number | `ecosystem.config.js` + new `.env.*` file |
| Change nginx settings | `deploy/nginx/bluebubbles-api.conf` (or per-instance copy in nginx servers dir) |
| Update API code | `src/` directory, then `npm run build` + `pm2 restart bb-tyler-iphone` |

---

*This report was generated from a full review of the codebase, test suite, and documentation as of April 3, 2026.*
