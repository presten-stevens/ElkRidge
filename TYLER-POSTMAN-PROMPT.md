# BlueBubbles iMessage API — Postman Testing Guide

Help me test a BlueBubbles iMessage API using Postman. The API is live and ready. Walk me through setting up and running each request below.

---

## Setup

1. Create a new Postman collection called "BlueBubbles API"
2. Add a collection-level header: `Authorization` = `Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc`

---

## Tests to Run (in order)

### Test 1: Health Check

- **Method:** GET
- **URL:** `https://api.elkbb.dev/health`
- **Headers:** None needed
- **Expected:** 200 with `"status": "healthy"`

### Test 2: Send a Message

- **Method:** POST
- **URL:** `https://api.elkbb.dev/send`
- **Headers:** `Authorization: Bearer 58ecd1eb861128396011cf66ee7c9f105802a3322d4870f5ccdbe679c8dc32bc` and `Content-Type: application/json`
- **Body (raw JSON):**
```json
{"to": "+1XXXXXXXXXX", "message": "Test from Postman"}
```
- Replace `+1XXXXXXXXXX` with your own phone number
- **Expected:** 200 with `"status": "queued"` — check your phone, message should arrive in a few seconds

### Test 3: List Conversations

- **Method:** GET
- **URL:** `https://api.elkbb.dev/conversations?limit=10`
- **Headers:** Authorization header
- **Expected:** 200 with list of conversation threads

### Test 4: Get Messages in a Conversation

- **Method:** GET
- **URL:** `https://api.elkbb.dev/conversations/THREAD_ID?limit=10`
- **Headers:** Authorization header
- Replace `THREAD_ID` with an `id` from Test 3's response (looks like `any;-;+15551234567`)
- **Expected:** 200 with list of messages

---

## If Something Fails

| Error | Meaning |
|-------|---------|
| 401 | Check the Authorization header is correct |
| 429 | Rate limited — wait a minute and retry |
| 503 | Server is down — try the health check first |
