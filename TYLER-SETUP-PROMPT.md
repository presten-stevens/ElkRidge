# BlueBubbles iMessage API — CRM Integration Setup

You are helping me integrate my CRM with a BlueBubbles iMessage API. The API is already deployed and working. I need you to help me connect my CRM so I can send and receive iMessages programmatically.

---

## My API Details

- **API URL:** `https://api.elkbb.dev`
- **API Key:** `58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc`
- **Auth method:** Include header `Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc` on every request

---

## Available Endpoints

### 1. Send an iMessage

```
POST https://api.elkbb.dev/send
Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc
Content-Type: application/json

{"to": "+15551234567", "message": "Your message here"}
```

Response: `{"messageId": "uuid", "status": "queued"}`

- Phone number can be any format — it gets auto-normalized to E.164
- "queued" means accepted. The actual send happens async with a few seconds delay.
- Max message length: 5000 characters

### 2. List Conversations

```
GET https://api.elkbb.dev/conversations?offset=0&limit=25
Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc
```

Returns paginated list of conversation threads with last message and contact info.

### 3. Get Messages in a Conversation

```
GET https://api.elkbb.dev/conversations/{threadId}?offset=0&limit=25
Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc
```

Thread ID format: `iMessage;-;+15551234567` or `any;-;+15551234567`

### 4. Health Check (no auth needed)

```
GET https://api.elkbb.dev/health
```

Returns: `{"status": "healthy", "bluebubbles": {"status": "connected"}, "imessage": {"authenticated": true}}`

---

## Receiving Inbound Messages (Webhooks)

When someone texts this iMessage number, the API will POST to a webhook URL that I configure. The webhook payload looks like:

```json
{
  "type": "inbound_message",
  "messageId": "guid-from-bluebubbles",
  "sender": "+15551234567",
  "body": "The message text",
  "timestamp": "2026-04-08T21:34:01.945Z",
  "threadId": "any;-;+15551234567"
}
```

Delivery confirmations:

```json
{
  "type": "delivery_confirmation",
  "messageId": "guid",
  "status": "delivered",
  "timestamp": "2026-04-08T21:35:00.000Z"
}
```

**My webhook endpoint needs to:**
- Accept POST requests with JSON body
- Return 200 quickly
- Failed deliveries are retried up to 5 times with exponential backoff

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| VALIDATION_ERROR | 400 | Bad request |
| INVALID_PHONE | 400 | Phone number can't be parsed |
| AUTH_FAILURE | 401 | Wrong or missing API key |
| RATE_LIMITED | 429 | Too many requests (retry later) |
| BB_OFFLINE | 503 | Server unreachable |
| SEND_FAILED | 500 | Send failed |

---

## Rate Limits

- 100 request capacity, refills 4 tokens per hour
- Messages are sent with a 2-8 second jitter delay to mimic human pacing
- If rate limited, you get a 429 with `"retryable": true`

---

## What I Need Help With

1. Set up my CRM to call `POST /send` when I want to text someone
2. Create a webhook endpoint on my CRM that accepts inbound message POSTs
3. Once my webhook is ready, I'll give the URL to the server admin to configure
4. (Optional) Display conversation history in my CRM using the GET endpoints

---

## Quick Test

Verify the API is working:

```bash
curl https://api.elkbb.dev/health
```

Send a test message (replace the phone number with your own):

```bash
curl -X POST https://api.elkbb.dev/send \
  -H "Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc" \
  -H "Content-Type: application/json" \
  -d '{"to": "+1XXXXXXXXXX", "message": "Test from API"}'
```
