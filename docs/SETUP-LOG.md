# BlueBubbles API — Local Setup Log

Steps taken to get the ElkRidge BlueBubbles API running on Elk's Mac mini (2026-04-01).

## Prerequisites Installed

1. **Node.js** — installed via Homebrew
   ```bash
   brew install node
   ```
2. **npm dependencies**
   ```bash
   npm install
   ```
3. **tsx** — added as dev dependency for running TypeScript directly in dev mode
   ```bash
   npm install -D tsx
   ```

## Environment Configuration

1. Copied `.env.example` to `.env`
2. Set the following values:
   - `BLUEBUBBLES_URL=http://localhost:1234`
   - `BLUEBUBBLES_PASSWORD=<your BB password>`
   - `API_KEY=<your API key, min 16 chars>`
   - `CRM_WEBHOOK_URL` and `ALERT_WEBHOOK_URL` — leave commented out until production
3. Empty string values for optional URL fields will fail validation — comment them out instead

## BlueBubbles Server Configuration

### Requirements
- BlueBubbles server running on the Mac
- Messages app open and signed into iMessage
- SIP (System Integrity Protection) disabled

### Private API Setup
The Private API must be enabled and connected for sending messages:

1. Open BlueBubbles → **Settings** (sidebar)
2. Go to the **Private API** section
3. Confirm **SIP Disabled: Pass** under Private API Requirements
4. Check **Messages Private API** checkbox
5. Verify **Private API Status → Connected: Yes**
6. If Connected shows **No**, uncheck and re-check the Messages Private API checkbox to force re-injection of the helper dylib

### iMessage Authentication
- The Mac must be signed into iMessage in the Messages app
- If only an email address is available (no phone number linked), the API sends iMessages via email address
- To link a phone number: on the iPhone with the same Apple ID, go to **Settings → Messages → Text Message Forwarding** and enable the Mac
- **Note:** Phone number linking requires the same Apple ID on both iPhone and Mac

## Integration Fixes Applied

The following issues were discovered and fixed during live testing:

### WebSocket Auth (bb-events.ts)
BlueBubbles expects the password as a **query parameter**, not in the socket `auth` object:
```typescript
// Before (broken — immediate disconnect)
socket = io(url, { auth: { password } });

// After (working)
socket = io(url, { query: { password } });
```

### Private API Send Method (bluebubbles.ts)
BlueBubbles requires `"method": "private-api"` in the send payload when the Private API helper is connected. Without it, it falls back to AppleScript which fails:
```typescript
body: JSON.stringify({
  chatGuid,
  tempGuid,
  message,
  method: 'private-api',  // required
})
```

### Send Timeout (bluebubbles.ts)
BlueBubbles can take 30-90+ seconds to return from the send endpoint (waits for Apple delivery confirmation). Default 10s timeout was too short:
```typescript
signal: AbortSignal.timeout(120_000)  // 2 minutes for send
```
The `request()` method was also reordered to allow callers to override the default signal.

### Message Query Endpoint (bluebubbles.ts)
BlueBubbles uses `POST /api/v1/message/query` for fetching messages, not `GET /api/v1/message` (which returns 404):
```typescript
// Before (broken)
GET /api/v1/message?limit=100&offset=0&sort=ASC&after=12345

// After (working)
POST /api/v1/message/query
{ "limit": 100, "offset": 0, "sort": "ASC", "after": 12345 }
```

### Sync State Race Condition (sync-state.ts)
Multiple WebSocket events arriving simultaneously caused concurrent `writeSyncState` calls to race on the temp file, crashing with ENOENT. Fixed by serializing writes with a promise chain and caching the `mkdir` call.

### Email Recipient Support (send.ts, bluebubbles.ts)
Added email address support in the send route since this Mac only has iMessage via email (no phone number linked):
- Send route detects email vs phone and skips phone normalization for emails
- BB client uses `iMessage;-;email@example.com` chatGuid for email recipients vs `any;-;+1234567890` for phone numbers

### Dev Script (package.json)
Node 25 doesn't natively resolve `.js` imports to `.ts` files. Switched dev script from `node --watch` to `tsx watch`.

## Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm run start:prod  # uses PM2
```

### Tests
```bash
npm test            # 171 tests across 18 files
npm run typecheck   # type checking without build
```

## Testing the API

```bash
# Health check (no auth required)
curl http://localhost:3000/health

# Send a message
curl -X POST http://localhost:3000/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to": "someone@icloud.com", "message": "Hello from the API"}'

# List conversations
curl http://localhost:3000/conversations \
  -H "Authorization: Bearer YOUR_API_KEY"

# Get messages in a conversation
curl http://localhost:3000/conversations/CHAT_GUID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Known Limitations

- `detected_imessage` shows `null` in BlueBubbles server info when only an email is registered (no phone number). The API shows "degraded" health status but messaging works fine via email.
- BlueBubbles send endpoint is slow (30-90s) because it waits for Apple delivery confirmation. The API returns `"status": "queued"` immediately and sends asynchronously.
- SMS/Android messaging requires the same Apple ID on the Mac and an iPhone with Text Message Forwarding enabled.
