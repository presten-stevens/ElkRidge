# BlueBubbles iMessage API Reference

Base URL: `https://YOUR_DOMAIN`

All requests and responses use JSON (`Content-Type: application/json`).

---

## CRM Integration Guide

This section explains how to connect your CRM (or any backend system) to this API. There are two sides to the integration: **sending messages** (your CRM calls our API) and **receiving messages** (our API calls your CRM).

### Step 1: Get Your API Key

Your API key is configured on the server via the `API_KEY` environment variable. You'll use this key in every request. Include it as a Bearer token:

```
Authorization: Bearer YOUR_API_KEY
```

### Step 2: Send Messages from Your CRM

When a user in your CRM wants to text someone, make an HTTP POST to `/send`:

```bash
curl -X POST https://YOUR_DOMAIN/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to": "+15551234567", "message": "Hey Tyler, following up on our call"}'
```

The response gives you a `messageId` you can store in your CRM to track the message:

```json
{
  "messageId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued"
}
```

**"queued" means accepted, not delivered.** The actual iMessage send happens asynchronously. Delivery confirmation arrives via webhook (see Step 3).

### Step 3: Receive Messages in Your CRM

You need to set up a **webhook endpoint** on your CRM — a URL that accepts HTTP POST requests. Configure this URL on the server via the `CRM_WEBHOOK_URL` environment variable.

When someone texts the iMessage number, our API sends a POST to your webhook:

```json
{
  "type": "inbound_message",
  "messageId": "guid-from-bluebubbles",
  "sender": "+15551234567",
  "body": "Hey, are you available?",
  "timestamp": "2026-03-30T12:00:00.000Z",
  "threadId": "iMessage;-;+15551234567"
}
```

When a sent message is delivered or read, you get a delivery confirmation:

```json
{
  "type": "delivery_confirmation",
  "messageId": "guid-from-bluebubbles",
  "status": "delivered",
  "timestamp": "2026-03-30T12:01:00.000Z"
}
```

**Your webhook endpoint should:**
- Accept POST requests with JSON body
- Return a 200 status code quickly (within a few seconds)
- Do any heavy processing (saving to database, updating UI) asynchronously after returning 200
- If your endpoint returns an error or times out, we retry with exponential backoff (up to 5 attempts)

### Step 4: Pull Conversation History

To display past messages in your CRM, use the conversation endpoints:

```bash
# List all conversations
curl "https://YOUR_DOMAIN/conversations?limit=50" \
  -H "Authorization: Bearer YOUR_API_KEY"

# Get messages in a specific conversation
curl "https://YOUR_DOMAIN/conversations/iMessage;-;+15551234567?limit=50" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Step 5: Monitor Health (Optional)

If you want your CRM to show the connection status, poll the health endpoint:

```bash
curl https://YOUR_DOMAIN/health
```

No auth required. Returns `healthy`, `degraded`, or `down`.

You can also configure `ALERT_WEBHOOK_URL` on the server to receive automatic downtime alerts — same webhook pattern as above, with a `downtime_alert` payload.

### Integration Checklist

- [ ] Generate an API key (at least 16 characters): `openssl rand -hex 32`
- [ ] Set `API_KEY` on the server
- [ ] Build a webhook endpoint on your CRM that accepts POST with JSON body and returns 200
- [ ] Set `CRM_WEBHOOK_URL` on the server to point to your webhook endpoint
- [ ] Add HTTP client calls in your CRM to POST /send when users want to text
- [ ] (Optional) Add GET /conversations calls to display message history in your CRM
- [ ] (Optional) Set `ALERT_WEBHOOK_URL` to receive downtime alerts
- [ ] Test: send a message via API, reply from a phone, verify webhook fires to your CRM

---

## Authentication

All endpoints except `GET /health` require a Bearer token in the `Authorization` header.

```
Authorization: Bearer YOUR_API_KEY
```

- The API key is configured via the `API_KEY` environment variable on the server.
- `API_KEY` must be at least 16 characters.
- `API_KEY` is required in production (`NODE_ENV=production`). In development, if `API_KEY` is not set, authentication is disabled.
- Missing or invalid keys return `401` with error code `AUTH_FAILURE`.

**Example:**

```bash
curl -X GET https://YOUR_DOMAIN/conversations \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Endpoints

### POST /send

Send an iMessage to a phone number.

**Request Body:**

| Field     | Type   | Required | Description                                      |
|-----------|--------|----------|--------------------------------------------------|
| `to`      | string | Yes      | Phone number (any format, auto-normalized to E.164) |
| `message` | string | Yes      | Message body, 1-5000 characters                  |

```json
{
  "to": "+15551234567",
  "message": "Hello from API"
}
```

**Response (200):**

```json
{
  "messageId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued"
}
```

> **Note:** A `"queued"` status means the message was accepted for sending. It does not mean the message has been delivered. Delivery confirmation is sent asynchronously via webhook (see [Webhook Events](#webhook-events)).

**Errors:**

| Code              | HTTP Status | Description                           |
|-------------------|-------------|---------------------------------------|
| VALIDATION_ERROR  | 400         | Missing or invalid `to` or `message`  |
| INVALID_PHONE     | 400         | Phone number could not be normalized to E.164 |
| RATE_LIMITED      | 429         | Too many requests, retry after delay  |
| BB_OFFLINE        | 503         | BlueBubbles server is not reachable   |
| INTERNAL_ERROR    | 500         | Unexpected server error               |

**curl Example (POST /send):**

```bash
curl -X POST https://YOUR_DOMAIN/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to": "+15551234567", "message": "Hello from API"}'
```

---

### GET /conversations

List all conversation threads.

**Query Parameters:**

| Parameter | Type   | Default | Description                              |
|-----------|--------|---------|------------------------------------------|
| `offset`  | number | 0       | Number of conversations to skip          |
| `limit`   | number | 25      | Number of conversations to return (max 100, silently clamped) |

**Response (200):**

```json
{
  "data": [
    {
      "id": "iMessage;-;+15551234567",
      "contact": "+15551234567",
      "lastMessage": "Hey, got it!",
      "timestamp": "2026-03-30T12:00:00.000Z",
      "unreadCount": 2
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 25,
    "total": 142
  }
}
```

**Errors:**

| Code             | HTTP Status | Description                                |
|------------------|-------------|--------------------------------------------|
| VALIDATION_ERROR | 400         | Invalid `offset` or `limit` query params   |

**curl Example (GET /conversations):**

```bash
curl -X GET "https://YOUR_DOMAIN/conversations?offset=0&limit=25" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### GET /conversations/:id

Get the message history for a specific conversation.

**Path Parameters:**

| Parameter | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `id`      | string | Chat GUID from BlueBubbles (e.g., `iMessage;-;+15551234567`) |

**Query Parameters:**

| Parameter | Type   | Default | Description                              |
|-----------|--------|---------|------------------------------------------|
| `offset`  | number | 0       | Number of messages to skip               |
| `limit`   | number | 25      | Number of messages to return (max 100, silently clamped) |

**Response (200):**

```json
{
  "data": [
    {
      "id": "msg-abc123",
      "sender": "+15551234567",
      "body": "Hey, got it!",
      "timestamp": "2026-03-30T12:00:00.000Z",
      "isFromMe": false
    },
    {
      "id": "msg-def456",
      "sender": "me",
      "body": "Great, thanks!",
      "timestamp": "2026-03-30T12:01:00.000Z",
      "isFromMe": true
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 25,
    "total": 87
  }
}
```

**Errors:**

| Code             | HTTP Status | Description                                |
|------------------|-------------|--------------------------------------------|
| VALIDATION_ERROR | 400         | Invalid `offset` or `limit` query params   |

**curl Example (GET /conversations/:id):**

```bash
curl -X GET "https://YOUR_DOMAIN/conversations/iMessage;-;+15551234567?offset=0&limit=25" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### GET /health

Check the health of the BlueBubbles server, iPhone connection, and iMessage authentication.

**Authentication:** None required. This endpoint is public.

**Parameters:** None.

**Response (200):**

```json
{
  "status": "healthy",
  "bluebubbles": {
    "status": "connected",
    "version": "1.9.6"
  },
  "imessage": {
    "authenticated": true
  },
  "system": {
    "macosVersion": "14.3.1"
  },
  "timestamp": "2026-03-30T12:00:00.000Z",
  "lastChecked": "2026-03-30T11:59:00.000Z"
}
```

**Status Values:**

| Status     | Meaning                                             |
|------------|-----------------------------------------------------|
| `healthy`  | BlueBubbles connected and iMessage authenticated    |
| `degraded` | BlueBubbles connected but iMessage not authenticated |
| `down`     | BlueBubbles server is unreachable                   |

**curl Example:**

```bash
curl -X GET https://YOUR_DOMAIN/health
```

---

## Error Response Format

All errors follow this structure:

```json
{
  "error": {
    "message": "Human-readable error description",
    "code": "ERROR_CODE",
    "retryable": false
  }
}
```

- `message`: Describes the error. For `500+` status codes, the message is always `"Internal server error"` (sensitive details are never exposed).
- `code`: Machine-readable error code (see table below).
- `retryable`: Whether the client should retry the request.

---

## Error Code Reference

| Code                       | HTTP Status | Retryable | Description                                                        |
|----------------------------|-------------|-----------|--------------------------------------------------------------------|
| `VALIDATION_ERROR`         | 400         | No        | Request body or query parameters failed validation                 |
| `INVALID_PHONE`            | 400         | No        | Phone number could not be normalized to E.164 format               |
| `AUTH_FAILURE`             | 401         | No        | Missing or invalid API key                                         |
| `RATE_LIMITED`             | 429         | Yes       | Too many requests, retry after delay                               |
| `INTERNAL_ERROR`           | 500         | No        | Unexpected server error                                            |
| `SEND_FAILED`              | 500         | Yes       | BlueBubbles accepted the request but the send failed               |
| `BB_OFFLINE`               | 503         | Yes       | BlueBubbles server is not reachable                                |
| `BB_IMESSAGE_DISCONNECTED` | 503         | Yes       | iMessage is signed out or iPhone is disconnected                   |
| `WEBHOOK_DELIVERY_FAILED`  | N/A         | Yes       | CRM webhook delivery failed (internal, not returned to API clients) |

---

## Webhook Events

When `CRM_WEBHOOK_URL` is configured, the API forwards events from BlueBubbles to your CRM via HTTP POST.

### Inbound Message

Fires when a new iMessage is received.

```json
{
  "type": "inbound_message",
  "messageId": "guid-from-bluebubbles",
  "sender": "+15551234567",
  "body": "Hey, are you available?",
  "timestamp": "2026-03-30T12:00:00.000Z",
  "threadId": "iMessage;-;+15551234567"
}
```

### Delivery Confirmation

Fires when BlueBubbles reports a sent message was delivered or read.

```json
{
  "type": "delivery_confirmation",
  "messageId": "guid-from-bluebubbles",
  "status": "delivered",
  "timestamp": "2026-03-30T12:01:00.000Z"
}
```

**Status values:** `delivered`, `read`, `unknown`

### Behavior

- **Deduplication:** Duplicate events from BlueBubbles produce only one webhook fire.
- **Retry:** Failed webhook deliveries are retried with exponential backoff (up to 5 attempts).
- **Queue size:** The retry queue holds up to 1000 entries by default (configurable via `RETRY_QUEUE_MAX_SIZE`).
- **Backfill:** On reconnect, the server queries BlueBubbles for messages received since `last_synced_at` and fires webhooks for any missed messages.

---

## Rate Limiting

Requests are rate-limited at two levels:

### Application Level

- **Token bucket** rate limiter with configurable capacity and refill rate.
- Default: 100 request capacity, refills 4 tokens per hour.
- Configurable via `RATE_LIMIT_CAPACITY` and `RATE_LIMIT_REFILL_PER_HOUR` environment variables.
- Requests that exceed the limit receive `429` with the `RATE_LIMITED` error code.

### Nginx Level (Defense in Depth)

- **10 requests per second** with a burst allowance of 20.
- Provides a secondary safeguard in front of the application.

When rate limited, the response is:

```json
{
  "error": {
    "message": "Rate limit exceeded. Try again later.",
    "code": "RATE_LIMITED",
    "retryable": true
  }
}
```
