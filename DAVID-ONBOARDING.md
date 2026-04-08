# BlueBubbles iMessage API — David's Testing Guide

You are helping test and review a BlueBubbles iMessage API deployment. Below is everything you need to test the endpoints via Postman or curl. Copy this entire document into Claude if you need help building requests or debugging responses.

---

## Connection Details

### Direct BlueBubbles Server (live now)

- **Server URL:** `https://bb1.elkbb.dev`
- **BlueBubbles Password:** `RedBubble909`
- **Auth method:** Query parameter `password=RedBubble909` on every request

### ElkRidge API Wrapper (live)

- **Wrapper URL:** `https://api.elkbb.dev`
- **API Key:** `58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc`
- **Auth method:** Header `Authorization: Bearer <API_KEY>`

---

## Part 1: Test the Direct BlueBubbles API

These hit BlueBubbles directly. Use these to verify the server is reachable and iMessage is working.

### 1. Server Info (verify connection)

```bash
curl "https://bb1.elkbb.dev/api/v1/server/info?password=RedBubble909"
```

**Expected:** JSON with server version, macOS version, iMessage status.

### 2. List Recent Chats

```bash
curl "https://bb1.elkbb.dev/api/v1/chat?password=RedBubble909&limit=10&offset=0&sort=lastmessage&with=lastMessage"
```

**Expected:** Array of chat objects with participants and last messages.

### 3. Get Messages from a Chat

Replace `CHAT_GUID` with a chat ID from the previous response (e.g., `iMessage;-;+15551234567`):

```bash
curl "https://bb1.elkbb.dev/api/v1/chat/CHAT_GUID/message?password=RedBubble909&limit=25&offset=0&sort=DESC"
```

### 4. Send a Test iMessage

**⚠️ This sends a real iMessage from Tyler's number. Use a test number you control.**

```bash
curl -X POST "https://bb1.elkbb.dev/api/v1/message/text?password=RedBubble909" \
  -H "Content-Type: application/json" \
  -d '{
    "chatGuid": "iMessage;-;+1XXXXXXXXXX",
    "tempGuid": "temp-test-001",
    "message": "Test message from BlueBubbles API",
    "method": "private-api"
  }'
```

Replace `+1XXXXXXXXXX` with the recipient's phone number in E.164 format.

**Expected:** 200 OK with message GUID confirming it was sent.

### 5. Search Messages

```bash
curl -X POST "https://bb1.elkbb.dev/api/v1/message/query?password=RedBubble909" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 25,
    "offset": 0,
    "sort": "DESC",
    "where": [{"statement": "message.text LIKE :term", "args": {"term": "%hello%"}}]
  }'
```

### 6. Get Contacts

```bash
curl "https://bb1.elkbb.dev/api/v1/contact?password=RedBubble909"
```

### 7. Check iMessage Connection Status

```bash
curl "https://bb1.elkbb.dev/api/v1/fcm/client?password=RedBubble909"
```

---

## Part 2: Test the ElkRidge Wrapper API (live)

The wrapper simplifies the BlueBubbles API into 4 clean endpoints with bearer token auth, rate limiting, and webhook support.

### Health Check (no auth required)

```bash
curl https://api.elkbb.dev/health
```

**Expected:** `{"status": "healthy", "bluebubbles": {"status": "connected"}, ...}`

### Send a Message

**⚠️ This sends a real iMessage. Use a test number you control.**

```bash
curl -X POST https://api.elkbb.dev/send \
  -H "Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc" \
  -H "Content-Type: application/json" \
  -d '{"to": "+15551234567", "message": "Hello from ElkRidge API"}'
```

**Expected:** `{"messageId": "...", "status": "queued"}`

### List Conversations

```bash
curl "https://api.elkbb.dev/conversations?limit=50" \
  -H "Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc"
```

### Get Messages in a Conversation

```bash
curl "https://api.elkbb.dev/conversations/iMessage;-;+15551234567?limit=50" \
  -H "Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc"
```

---

## Postman Setup

If you prefer Postman:

1. **Create a new collection** called "BlueBubbles API"
2. **Set collection variable** `base_url` = `https://bb1.elkbb.dev`
3. **Set collection variable** `password` = `RedBubble909`
4. **For direct BB endpoints:** Use `{{base_url}}/api/v1/...?password={{password}}`
5. **For wrapper endpoints:** Set `base_url` = `https://api.elkbb.dev` and add header `Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc`

---

## Error Codes (Wrapper API)

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Bad request body or params |
| `INVALID_PHONE` | 400 | Phone number can't be parsed |
| `AUTH_FAILURE` | 401 | Missing or wrong API key |
| `RATE_LIMITED` | 429 | Too many requests (retry later) |
| `BB_OFFLINE` | 503 | BlueBubbles server unreachable |
| `BB_IMESSAGE_DISCONNECTED` | 503 | iMessage signed out |
| `SEND_FAILED` | 500 | Send accepted but failed |

---

## What David Should Review

1. **Can you hit all the direct BB endpoints above?** Note any that fail.
2. **Send a test iMessage** to your own phone — did it arrive as iMessage (blue bubble)?
3. **Reply to that message** — can you see it via the "Get Messages" endpoint?
4. **Think about user hierarchy:** Who should be able to send? Who's read-only? What privilege tiers make sense for your team?
5. **Webhook integration:** What URL should inbound messages and delivery confirmations be sent to on your CRM side?

---

## Architecture Overview

```
                    Internet
                       │
                       ▼
              Cloudflare Tunnel
              (bb1.elkbb.dev)
                       │
                       ▼
               ┌───────────────┐
               │  Mac Mini     │
               │               │
               │  BlueBubbles  │ ← port 1235 (direct API)
               │  Server       │
               │               │
               │  ElkRidge     │ ← port 3000 (api.elkbb.dev)
               │  Wrapper      │
               │               │
               │  iMessage     │ ← Tyler's Apple ID
               └───────────────┘
```

The Cloudflare Tunnel provides HTTPS automatically. No ports are exposed on the Mac Mini's firewall. The tunnel runs as a persistent service and auto-starts on boot.
