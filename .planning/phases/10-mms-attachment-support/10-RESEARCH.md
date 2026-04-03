# Phase 10: MMS & Attachment Support - Research

**Researched:** 2026-04-03
**Domain:** BlueBubbles attachment API, multipart file handling, Express middleware
**Confidence:** HIGH

## Summary

BlueBubbles has well-defined REST API endpoints for both sending and receiving attachments. Sending uses `POST /api/v1/message/attachment` with multipart form data. Downloading uses `GET /api/v1/attachment/{guid}/download?password=...`. The socket `new-message` event already delivers attachment metadata in the `attachments` array (guid, mimeType, transferName, totalBytes) -- our existing `BBSocketMessage` type already declares this field.

The implementation breaks into three concerns: (1) enriching inbound webhook payloads with attachment metadata from the existing socket event data, (2) adding a proxy endpoint to serve attachment downloads through our API (avoiding exposing BB credentials in direct URLs), and (3) extending the send endpoint to accept file uploads via multipart form data and forward them to BlueBubbles. Express needs `multer` for multipart parsing. The existing text-only flow must remain backward compatible -- messages without attachments should produce identical payloads to what Tyler's CRM already handles.

**Primary recommendation:** Use multer for multipart parsing, proxy attachment downloads through our API (never expose BB URLs/credentials to Tyler), and extend webhook payloads with an optional `attachments` array.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EMSG-01 | MMS/media message support (images, attachments) | BB API has dedicated attachment send (`/api/v1/message/attachment`) and download (`/api/v1/attachment/{guid}/download`) endpoints. Socket events already include attachment metadata. Multer handles multipart form data in Express. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| multer | 2.1.1 | Multipart form data parsing for Express | De facto standard for Express file uploads; handles temp files, size limits, field validation |
| @types/multer | 2.1.0 | TypeScript types for multer | Type safety for middleware and file objects |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| express (existing) | ^5.2.1 | HTTP framework | Already installed -- routes and middleware |
| zod (existing) | ^4.3.6 | Request validation | Already installed -- validate non-file fields in multipart requests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| multer | formidable | formidable is more feature-rich but heavier; multer is Express-native and simpler |
| multer | busboy directly | Lower-level, no Express middleware integration; multer wraps busboy already |
| Proxy endpoint | Direct BB URL pass-through | Exposing BB URLs leaks the server address and password -- proxy is mandatory for security |

**Installation:**
```bash
npm install multer
npm install -D @types/multer
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  routes/
    send.ts            # Extended: multipart send with attachment
    attachments.ts     # NEW: GET /attachments/:guid (proxy download)
  services/
    bluebubbles.ts     # Extended: sendAttachment method
    webhook-relay.ts   # Extended: mapInboundMessage includes attachments
  types/
    bluebubbles.ts     # Extended: BBAttachment type, BBMessage attachments field
    webhook.ts         # Extended: InboundMessagePayload attachments field
    api.ts             # Extended: Message type attachments field, AttachmentMeta type
  middleware/
    upload.ts          # NEW: multer config (memoryStorage, size limits, file filter)
```

### Pattern 1: Multer Memory Storage for Proxied Uploads
**What:** Use multer with memoryStorage so the uploaded file stays in a Buffer, then forward it as a FormData multipart POST to BlueBubbles. No temp files on disk.
**When to use:** When the API is a thin proxy and files should not be persisted.
**Example:**
```typescript
// Source: multer docs + Node.js FormData API
import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (Cloudflare limit)
  fileFilter: (_req, file, cb) => {
    // Allow common image/video/document types
    const allowed = /^(image|video|audio|application\/pdf|application\/msword)/;
    cb(null, allowed.test(file.mimetype));
  },
});

// Route handler
sendRouter.post('/send', upload.single('attachment'), async (req, res) => {
  // req.file is the uploaded file (if any)
  // req.body contains text fields (to, message)
});
```

### Pattern 2: Attachment Download Proxy
**What:** A GET endpoint that streams the attachment from BlueBubbles through our API, adding auth and hiding BB credentials.
**When to use:** When Tyler's CRM needs to download attachments referenced in webhook payloads.
**Example:**
```typescript
// Source: BlueBubbles API pattern from .NET client + gist
attachmentsRouter.get('/attachments/:guid', async (req, res) => {
  const bbUrl = `${env.BLUEBUBBLES_URL}/api/v1/attachment/${encodeURIComponent(req.params.guid)}/download?password=${env.BLUEBUBBLES_PASSWORD}`;
  const upstream = await fetch(bbUrl);
  if (!upstream.ok) throw new AppError('Attachment not found', ...);

  res.set('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  res.set('Content-Length', upstream.headers.get('content-length') ?? '');
  // Stream the response body through
  const reader = upstream.body;
  if (reader) Readable.fromWeb(reader as any).pipe(res);
});
```

### Pattern 3: Backward-Compatible Webhook Payload Extension
**What:** Add optional `attachments` array to InboundMessagePayload. When no attachments exist, field is either omitted or empty array -- existing CRM integration is unaffected.
**When to use:** Always -- this is the approach for the webhook enrichment.
**Example:**
```typescript
export interface AttachmentMeta {
  guid: string;
  mimeType: string;
  filename: string;
  size: number;
  downloadUrl: string; // Our proxy URL, not BB URL
}

export interface InboundMessagePayload {
  type: 'inbound_message';
  messageId: string;
  sender: string;
  body: string;
  timestamp: string;
  threadId: string;
  attachments?: AttachmentMeta[]; // NEW -- optional for backward compat
}
```

### Pattern 4: Forwarding Attachment to BlueBubbles via FormData
**What:** Construct a Node.js FormData object from the multer buffer and POST it to BB's multipart endpoint.
**When to use:** When sending a message with an attachment through our API.
**Example:**
```typescript
// Source: BlueBubbles API gist (curl example translated to Node.js)
async sendAttachment(
  phone: string,
  message: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
): Promise<{ guid: string }> {
  const tempGuid = crypto.randomUUID();
  const form = new FormData();
  form.append('chatGuid', `any;-;${phone}`);
  form.append('tempGuid', `temp-${tempGuid}`);
  form.append('message', message);
  form.append('attachment', new Blob([file.buffer], { type: file.mimetype }), file.originalname);

  const url = new URL('/api/v1/message/attachment', this.baseUrl);
  url.searchParams.set('password', this.password);

  const response = await fetch(url.toString(), {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000), // Longer timeout for file uploads
  });

  const body = await response.json();
  if (body.status !== 200) throw new AppError(...);
  return body.data;
}
```

### Anti-Patterns to Avoid
- **Exposing BB attachment URLs directly:** Never include `http://localhost:1234/api/v1/attachment/...?password=...` in webhook payloads. Always use our proxy URL.
- **Base64 in JSON body for uploads:** Inflates payload by ~33%, breaks streaming, and is unnecessary when multipart works fine. Use multipart form data.
- **Storing attachments on disk:** Our API is a proxy. BB stores the files. We stream them through.
- **Blocking on attachment upload timeout:** File uploads can be slow. Use a longer timeout (60s vs 10s for text) but still fire-and-forget for the HTTP response.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart form parsing | Custom stream parser | multer | Multipart boundaries, encoding, limits -- deceptively complex |
| MIME type validation | Regex on filename extension | multer fileFilter + file.mimetype | Content-Type header from client is more reliable than extension guessing |
| File size limits | Manual Content-Length checking | multer limits option | Handles chunked transfers and partial reads correctly |
| Streaming proxy responses | Manual chunk forwarding | Readable.fromWeb().pipe(res) | Node.js stream backpressure handled correctly |

**Key insight:** The attachment feature is a proxy layer, not a storage layer. BlueBubbles stores files. We forward them. Keep it thin.

## Common Pitfalls

### Pitfall 1: Multer Must Come Before express.json()
**What goes wrong:** If `express.json()` consumes the request body before multer processes it, multipart form data is lost.
**Why it happens:** Express body parsers are greedy -- they read the stream once.
**How to avoid:** Apply multer as route-level middleware on specific endpoints (not app-level). The existing `app.use(express.json())` is fine because multer on specific routes will handle the body before JSON parser sees it (multer handles content-type routing).
**Warning signs:** `req.file` is undefined, `req.body` is empty on multipart requests.

### Pitfall 2: Credential Leak in Attachment URLs
**What goes wrong:** Webhook payload includes direct BB URL with `?password=...` in the attachment download URL.
**Why it happens:** Laziness -- just pass through the BB URL instead of building a proxy URL.
**How to avoid:** Always construct download URLs as `https://our-api.example.com/attachments/{guid}`. The proxy handler adds the BB password internally.
**Warning signs:** Webhook payloads contain `localhost:1234` or `password=` in any URL field.

### Pitfall 3: Timeout Too Short for Large Files
**What goes wrong:** 10-second AbortSignal.timeout kills uploads/downloads of large files (videos, high-res images).
**Why it happens:** Existing BB client uses 10s timeout for text API calls.
**How to avoid:** Use 60s timeout for attachment operations. Separate timeout config for attachment vs text API calls.
**Warning signs:** Large file sends fail with "BlueBubbles server is unreachable" errors.

### Pitfall 4: Missing Content-Type on Proxy Response
**What goes wrong:** Browser/CRM can't display the attachment because the proxy doesn't forward Content-Type.
**Why it happens:** Forgetting to copy headers from BB response to our response.
**How to avoid:** Always set Content-Type and Content-Length from the upstream BB response.
**Warning signs:** Attachments download as generic binary files instead of rendering as images.

### Pitfall 5: express.json() Rejecting Multipart Requests
**What goes wrong:** When multer handles a route, `express.json()` at app-level might still try to parse the body and fail on non-JSON content-type.
**Why it happens:** `express.json()` only parses `application/json` content-type, so it should skip multipart. However, if multer is not applied correctly, the body may not be parsed at all.
**How to avoid:** Verify multer is applied as route-level middleware and that it correctly handles the `multipart/form-data` content-type. Express.json() will skip non-JSON content types by default.
**Warning signs:** 400 errors on multipart POST requests.

### Pitfall 6: Backfill Does Not Include Attachment Metadata
**What goes wrong:** Messages backfilled after downtime are missing attachment info because `BBMessage` type doesn't include attachments and backfill builds payloads manually.
**Why it happens:** The current `BBMessage` type is minimal -- no `attachments` field. Backfill constructs `InboundMessagePayload` directly.
**How to avoid:** Extend `BBMessage` to include `attachments` and update the backfill mapper to include attachment metadata.
**Warning signs:** Attachment messages received during downtime appear as text-only in CRM after backfill.

## Code Examples

### BlueBubbles Attachment API Endpoints

```
# Send attachment (multipart form data)
POST /api/v1/message/attachment?password={password}
Content-Type: multipart/form-data

Fields:
  chatGuid: "any;-;+1234567890"
  tempGuid: "temp-{uuid}"
  message: "Check out this file!"      (optional text with attachment)
  attachment: <binary file data>

# Download attachment
GET /api/v1/attachment/{guid}/download?password={password}
Response: binary file data with Content-Type header
```

### BlueBubbles Attachment Object (from socket events and API responses)

```typescript
// Source: mautrix-imessage Go types + existing BBSocketMessage
interface BBAttachment {
  originalROWID?: number;
  guid: string;
  uti?: string;           // Uniform Type Identifier (Apple-specific)
  mimeType: string;       // e.g. "image/jpeg", "video/mp4"
  transferName: string;   // Original filename
  totalBytes: number;     // File size in bytes
  transferState?: number; // 0 = not started, 5 = complete
  isOutgoing?: boolean;
  hideAttachment?: boolean;
  isSticker?: boolean;
  originalGuid?: string;
  hasLivePhoto?: boolean;
  height?: number;        // Image/video height in pixels
  width?: number;         // Image/video width in pixels
  metadata?: unknown;
}
```

### Existing Code Touch Points

The `BBSocketMessage` already has the attachments field:
```typescript
// src/types/bluebubbles.ts line 30
attachments: Array<{ guid: string; mimeType: string; transferName: string; totalBytes: number }>;
```

The `mapInboundMessage` in webhook-relay.ts currently ignores attachments:
```typescript
// src/services/webhook-relay.ts line 13-21
export function mapInboundMessage(data: BBSocketMessage): InboundMessagePayload {
  return {
    type: 'inbound_message',
    messageId: data.guid,
    sender: data.handle?.address ?? 'Unknown',
    body: data.text ?? '',
    timestamp: new Date(data.dateCreated).toISOString(),
    threadId: data.chats?.[0]?.guid ?? '',
    // NO attachments field -- needs extension
  };
}
```

The `BBMessage` type used by backfill has NO attachments field:
```typescript
// src/types/bluebubbles.ts line 6-11
export interface BBMessage {
  guid: string;
  text: string | null;
  isFromMe: boolean;
  dateCreated: number;
  handle: { address: string } | null;
  // MISSING: attachments -- needs extension
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Base64 in JSON body | Multipart form data | Always was standard | Use multipart for sends, never base64 |
| formidable for Express | multer | multer became dominant ~2018 | multer is the standard Express choice |
| Disk storage temp files | memoryStorage for proxy pattern | N/A | No disk writes for pass-through proxy |

**Deprecated/outdated:**
- None relevant. The BlueBubbles API has been stable across recent versions.

## Open Questions

1. **Cloudflare 100MB limit**
   - What we know: If BB is behind Cloudflare proxy, file uploads are limited to 100MB. The gist mentions switching to zrok for larger files.
   - What's unclear: Whether Tyler's deployment uses Cloudflare. Our nginx setup would not have this limit.
   - Recommendation: Set multer limit to 100MB as a safe default. Make it configurable via env var.

2. **MMS vs iMessage attachment behavior**
   - What we know: iMessage supports arbitrary file types and large sizes. MMS (SMS fallback) is limited to ~1.2MB and specific media types.
   - What's unclear: Whether BlueBubbles handles the MMS size/format downgrade automatically or requires API-side handling.
   - Recommendation: Assume BlueBubbles handles protocol-level details. Our API accepts any file and lets BB/iMessage/MMS handle the rest.

3. **Multiple attachments per message**
   - What we know: BB's attachment field is an array, supporting multiple attachments per message.
   - What's unclear: Whether `POST /api/v1/message/attachment` supports multiple files in one request.
   - Recommendation: Support single attachment per send initially. Tyler can send multiple messages for multiple files. Simpler, backward compatible.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| multer (npm) | File upload parsing | Not yet installed | 2.1.1 (latest) | -- install via npm |
| Node.js FormData | Forwarding to BB | Built-in (Node 18+) | N/A | -- |
| Node.js Readable.fromWeb | Streaming proxy | Built-in (Node 18+) | N/A | -- |

**Missing dependencies with no fallback:** None -- all are installable or built-in.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements - Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EMSG-01a | Inbound webhook includes attachment metadata | unit | `npx vitest run src/services/__tests__/webhook-relay.test.ts -t "attachment" -x` | Wave 0 |
| EMSG-01b | POST /send with attachment file uploads correctly | unit | `npx vitest run src/routes/__tests__/send.test.ts -t "attachment" -x` | Wave 0 |
| EMSG-01c | GET /attachments/:guid proxies download from BB | unit | `npx vitest run src/routes/__tests__/attachments.test.ts -x` | Wave 0 |
| EMSG-01d | BlueBubblesClient.sendAttachment calls BB multipart endpoint | unit | `npx vitest run src/services/__tests__/bluebubbles.test.ts -t "attachment" -x` | Wave 0 |
| EMSG-01e | Backfill includes attachment metadata in payloads | unit | `npx vitest run src/services/__tests__/backfill.test.ts -t "attachment" -x` | Wave 0 |
| EMSG-01f | Text-only messages unaffected (backward compat) | unit | `npx vitest run src/services/__tests__/webhook-relay.test.ts -t "mapInboundMessage" -x` | Existing (verify) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/routes/__tests__/attachments.test.ts` -- covers EMSG-01c (new proxy endpoint)
- [ ] Extend `src/services/__tests__/webhook-relay.test.ts` -- covers EMSG-01a (attachment in payload)
- [ ] Extend `src/routes/__tests__/send.test.ts` -- covers EMSG-01b (multipart send)
- [ ] Extend `src/services/__tests__/bluebubbles.test.ts` -- covers EMSG-01d (sendAttachment method)
- [ ] Extend `src/services/__tests__/backfill.test.ts` -- covers EMSG-01e (backfill with attachments)

## Sources

### Primary (HIGH confidence)
- [mautrix-imessage/bluebubbles Go package](https://pkg.go.dev/go.mau.fi/mautrix-imessage/imessage/bluebubbles) - Full Attachment struct with all fields and JSON tags
- [BlueBubbles API gist](https://gist.github.com/hmseeb/e313cd954ad893b75433f2f2db0fb704) - Complete curl examples for send attachment endpoint, 100MB Cloudflare limit
- [BlueBubbles .NET API](https://github.com/dillydylann/BlueBubbles-API-NET) - Attachment model fields, download/send method signatures
- Existing codebase `src/types/bluebubbles.ts` - BBSocketMessage.attachments field already typed

### Secondary (MEDIUM confidence)
- [BlueBubbles REST API docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) - General API structure, authentication pattern
- [BlueBubbles Postman Collection](https://documenter.getpostman.com/view/765844/UV5RnfwM) - Endpoint reference (could not fetch full content)

### Tertiary (LOW confidence)
- MMS size limits (~1.2MB) from general iMessage knowledge -- not verified against BB behavior specifically

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - multer is the undisputed Express multipart library; BB endpoints verified across multiple sources
- Architecture: HIGH - proxy pattern is straightforward; existing codebase patterns are clear
- Pitfalls: HIGH - common Express/multer issues well-documented; credential leak pattern obvious from existing SECR-04 work

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable domain, BB API unlikely to change)
