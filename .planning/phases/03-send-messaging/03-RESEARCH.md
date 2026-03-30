# Phase 3: Send Messaging - Research

**Researched:** 2026-03-30
**Domain:** REST endpoint design, BlueBubbles API integration, rate limiting
**Confidence:** HIGH

## Summary

Phase 3 builds the POST /send endpoint, the shared BlueBubbles API client service, a token bucket rate limiter with human-like jitter, and extends the error handling system with typed error codes and retryable flags. The foundation from Phase 2 (Express 5 app, Zod validation, Pino logging, phone normalization) is solid and ready to extend.

The BlueBubbles send API is `POST /api/v1/message/text?password=<pw>` accepting `{ chatGuid, tempGuid, message }`. It returns the created message with a `guid` field that serves as our `messageId`. The chat GUID format for sending to a phone number is `"any;-;+<E.164 number>"` -- the `any` prefix tells BB to try iMessage first, falling back to SMS. Node 24's native `fetch` is stable and sufficient for BB API calls -- no need for axios or undici, keeping dependencies minimal.

**Primary recommendation:** Use Node 24 native `fetch` for the BlueBubbles client, implement a custom token bucket class (simple enough to not warrant a dependency), and define all error codes in a single `src/types/error-codes.ts` file per the locked decision.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Flat SCREAMING_SNAKE error codes with a `retryable: boolean` field in every error response. Response shape: `{ error: { message, code, retryable } }`.
- **D-02:** Error codes defined in a single `src/types/error-codes.ts` file as an exported const object to prevent string drift.
- **D-03:** Error code set for Phase 3: `VALIDATION_ERROR` (Zod failures, not retryable), `INVALID_PHONE` (E.164 normalization rejection, not retryable), `RATE_LIMITED` (token bucket exhausted, retryable), `BB_OFFLINE` (BlueBubbles unreachable, retryable), `BB_IMESSAGE_DISCONNECTED` (iMessage sign-out, retryable), `SEND_FAILED` (BB returned error but was reachable, not retryable).
- **D-04:** Update existing `src/middleware/error-handler.ts` to support the new error code and retryable fields.
- **D-05:** Token bucket algorithm, in-memory, per-instance (one instance = one phone number). No external dependencies.
- **D-06:** Default capacity: 100 tokens (configurable via env). Refill rate: ~4 tokens/hour. State resets on restart (acceptable -- conservative cold start).
- **D-07:** Jitter on every send: 2-8 second base delay with occasional longer pauses (30-90s) after every 3-5 sends. Goal: make send cadence look human to Apple's detection.
- **D-08:** When bucket is empty, return 429 with `RATE_LIMITED` error code and `retryable: true`. Do not queue -- reject immediately and let Tyler's CRM retry.
- **D-09:** Shared `BlueBubblesClient` service class in `src/services/bluebubbles.ts`. Centralizes BB URL + password config, handles auth, detects BB offline state, provides typed responses.
- **D-10:** All future phases import this client -- no direct fetch calls to BB from route handlers.
- **D-11:** BB offline detection: catch fetch errors (ECONNREFUSED, timeout) and throw typed errors that map to `BB_OFFLINE`. iMessage disconnection detected via BB API health response.
- **D-12:** POST /send accepts `{ to: string, message: string }`. Validates with Zod. Phone number normalized via `normalizePhone()` utility.
- **D-13:** Response on success: `{ messageId: string, status: "queued" }`. "queued" not "delivered" -- reflects actual iMessage behavior (SEND-03).
- **D-14:** Route stays thin (parse request, call service, return response). Business logic (BB API call, rate limiting check) lives in service layer.

### Claude's Discretion
- Whether to use native `fetch` or a library like `undici` for BB API calls
- Exact token bucket implementation details (class vs function)
- Test structure for send endpoint (unit tests for service, integration test for route)
- Whether to add a `Retry-After` header on 429 responses

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEND-01 | POST /send endpoint accepts phone number and message body, returns messageId | BB API returns `guid` in response data -- map to `messageId`. Chat GUID format: `any;-;+<E.164>`. Route + service layer pattern documented. |
| SEND-02 | Send endpoint returns structured error responses (invalid number, BB offline, auth failure) | Six error codes defined (D-03). Error handler upgrade pattern documented. `AppError` class with code + retryable fields. |
| SEND-03 | Send response indicates "queued" status (not "delivered") to reflect actual iMessage behavior | BB send is async -- message goes to Messages.app queue. Response: `{ messageId, status: "queued" }`. |
| SETUP-06 | Outbound message rate limiting with jitter to avoid Apple spam flagging | Token bucket with 100 capacity, ~4/hr refill. Jitter: 2-8s base + 30-90s pauses every 3-5 sends. Apple ~100/day threshold. |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.1 | HTTP framework | Already installed, async error handling |
| zod | 4.3.6 | Request body validation | Already installed, per Phase 2 pattern |
| pino | 10.3.1 | Structured logging | Already installed, credential redaction configured |
| libphonenumber-js | 1.12.41 | Phone normalization | Already installed, `normalizePhone()` exists |

### Supporting (no new dependencies needed)
| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| Node native `fetch` | Node 24.3.0 | HTTP client for BB API | Stable in Node 24, zero dependencies, sufficient for simple JSON POST/GET |
| `crypto.randomUUID()` | Node 24.3.0 | Generate `tempGuid` for BB API | Native, no dependency needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native fetch | axios | Axios adds interceptors and auto-retry, but we need neither -- BB auth is a query param (handled in client class), retry is handled by Tyler's CRM. Native fetch keeps deps at zero for this phase. |
| Native fetch | undici | Lower-level Node HTTP client. Overkill -- we need simple JSON POST. |
| Custom token bucket | ts-rate-limiter / express-rate-limit | External dependency for ~40 lines of code. Token bucket is simple enough to hand-roll, and our jitter requirements (human-like cadence) are custom enough that no library fits out of the box. |

**Installation:**
```bash
# No new packages needed -- Phase 2 dependencies cover everything
```

**Recommendation for Claude's Discretion items:**
- **Native `fetch`** over axios/undici. Rationale: Node 24 fetch is stable, BB API is simple JSON, no interceptors needed (credential handling lives in the client class method).
- **Class-based token bucket** in `src/services/rate-limiter.ts`. Rationale: class encapsulates state (tokens, lastRefill, sendCount for jitter), easy to test, matches the service layer pattern.
- **Add `Retry-After` header** on 429 responses. Rationale: standard HTTP practice, helps Tyler's CRM know when to retry. Calculate from token refill rate.

## Architecture Patterns

### Recommended Project Structure (Phase 3 additions)
```
src/
├── types/
│   └── error-codes.ts      # Centralized error code constants (D-02)
├── services/
│   ├── bluebubbles.ts       # BB API client (D-09)
│   └── rate-limiter.ts      # Token bucket with jitter (D-05)
├── routes/
│   ├── index.ts             # Mount send route
│   └── send.ts              # POST /send route handler (thin)
├── middleware/
│   └── error-handler.ts     # Extended with error codes + retryable (D-04)
├── config/
│   └── env.ts               # Extended with rate limit env vars
└── utils/
    └── phone.ts             # Existing, unchanged
```

### Pattern 1: AppError Class for Typed Errors
**What:** Custom error class that carries `code` (from error-codes.ts) and `retryable` boolean. Thrown by services, caught by error handler middleware.
**When to use:** Every error path in services should throw AppError, never raw Error.
**Example:**
```typescript
// src/types/errors.ts
import type { ErrorCode } from './error-codes.js';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly retryable: boolean,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

### Pattern 2: Thin Route, Fat Service
**What:** Route handler only parses request, calls service, returns response. All business logic in service layer.
**When to use:** Every route in this project (per D-14).
**Example:**
```typescript
// src/routes/send.ts
import { Router } from 'express';
import { z } from 'zod/v4';
import { normalizePhone } from '../utils/phone.js';
import { sendMessage } from '../services/bluebubbles.js';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';

const sendSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1).max(5000),
});

export const sendRouter = Router();

sendRouter.post('/send', async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid request body', ERROR_CODES.VALIDATION_ERROR, false, 400);
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.to);
  } catch {
    throw new AppError('Invalid phone number', ERROR_CODES.INVALID_PHONE, false, 400);
  }

  const result = await sendMessage(phone, parsed.data.message);
  res.status(200).json(result);
});
```

### Pattern 3: BlueBubbles Client with Offline Detection
**What:** Centralized client that wraps native fetch, appends BB password as query param, detects ECONNREFUSED/timeouts, validates response shape.
**When to use:** Every BB API call in the project.
**Example:**
```typescript
// src/services/bluebubbles.ts (core pattern)
import { env } from '../config/env.js';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';

export class BlueBubblesClient {
  private baseUrl: string;
  private password: string;

  constructor() {
    this.baseUrl = env.BLUEBUBBLES_URL;
    this.password = env.BLUEBUBBLES_PASSWORD;
  }

  private buildUrl(path: string): string {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set('password', this.password);
    return url.toString();
  }

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl(path), {
        ...options,
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });
    } catch (err) {
      // ECONNREFUSED, DNS failure, timeout
      throw new AppError(
        'BlueBubbles server is unreachable',
        ERROR_CODES.BB_OFFLINE,
        true,
        503,
      );
    }

    const body = await response.json();
    if (body.status !== 200) {
      throw new AppError(
        body.error?.error ?? 'BlueBubbles send failed',
        ERROR_CODES.SEND_FAILED,
        false,
        502,
      );
    }
    return body.data as T;
  }
}
```

### Pattern 4: Token Bucket with Human-Like Jitter
**What:** In-memory token bucket that enforces rate + adds random delay to each send.
**When to use:** Called before every BB send in the send service.
**Example:**
```typescript
// src/services/rate-limiter.ts (core algorithm)
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private sendCount: number = 0;

  constructor(
    private capacity: number,
    private refillPerHour: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 3_600_000; // hours
    const newTokens = elapsed * this.refillPerHour;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefill = now;
  }

  getJitterMs(): number {
    this.sendCount++;
    // Every 3-5 sends, add a longer pause
    const longPauseInterval = 3 + Math.floor(Math.random() * 3); // 3-5
    if (this.sendCount % longPauseInterval === 0) {
      return 30_000 + Math.random() * 60_000; // 30-90s
    }
    return 2_000 + Math.random() * 6_000; // 2-8s
  }

  get remainingTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}
```

### Anti-Patterns to Avoid
- **Direct fetch to BB from route handlers:** All BB calls go through `BlueBubblesClient` (D-10). Route handlers never import fetch or construct BB URLs.
- **String literal error codes:** Always use `ERROR_CODES.X` from the centralized file (D-02). Never write `'VALIDATION_ERROR'` as a string in handlers.
- **Queuing sends when rate limited:** Reject immediately with 429 (D-08). Tyler's CRM handles retry. Do not implement an internal send queue.
- **Returning "delivered" status:** BB send is async. Always return `"queued"` (D-13, SEND-03).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Phone validation | Custom regex | `libphonenumber-js` (already installed) via `normalizePhone()` | International format edge cases are endless |
| Request body validation | Manual field checks | `zod` schema + `safeParse` (already installed) | Type inference, consistent error messages |
| UUID generation | Custom ID generator | `crypto.randomUUID()` (Node native) | RFC 4122 compliant, cryptographically random |

**Key insight:** The token bucket IS worth hand-rolling because the jitter pattern (human-like cadence with occasional long pauses) is custom to this project and no library provides it out of the box. The bucket itself is ~40 lines. Everything else uses existing dependencies.

## Common Pitfalls

### Pitfall 1: BlueBubbles Password Leaking via fetch URL Logging
**What goes wrong:** Native fetch errors include the full URL in the error message. If you log the error, the BB password (in the query string) appears in logs.
**Why it happens:** `fetch('http://localhost:1234/api/v1/message/text?password=secret')` -- the password is in the URL.
**How to avoid:** In the `BlueBubblesClient.request()` catch block, never log the raw error. Construct a sanitized error message. Pino's redact config already covers `req.query.password` for HTTP request logging, but fetch errors bypass that.
**Warning signs:** Grep logs for the BB password value.

### Pitfall 2: Chat GUID Format Wrong for Phone Numbers
**What goes wrong:** Using `iMessage;-;+1234567890` format assumes the recipient has iMessage. If they don't, the send fails silently or BB errors.
**Why it happens:** BB documentation shows multiple GUID formats. The safe format is `any;-;+<E.164>` which lets BB try iMessage first, then SMS.
**How to avoid:** Always construct chat GUID as `any;-;+${normalizedPhone}`. Do not hardcode the service prefix.
**Warning signs:** Sends fail for some phone numbers but not others.

### Pitfall 3: Jitter Blocking the Event Loop
**What goes wrong:** Using `setTimeout` with a promise to implement jitter delay blocks the endpoint response for 2-90 seconds.
**Why it happens:** The jitter delay needs to happen before the BB API call, but the HTTP response should return immediately.
**How to avoid:** The jitter delay should be applied BEFORE sending to BB, and the entire send (jitter + BB call) happens asynchronously after the rate limit check passes. Return `{ messageId: tempGuid, status: "queued" }` immediately, then fire-and-forget the delayed send. The `tempGuid` serves as the messageId since we return before BB gives us the real GUID.
**Warning signs:** POST /send takes 2-90 seconds to respond.

### Pitfall 4: Token Bucket Not Refilling After Cold Start
**What goes wrong:** Bucket starts at capacity (100) but refills at 4/hour. After 100 sends, it takes 25 hours to fully refill.
**Why it happens:** The refill rate is intentionally slow (Apple ~100/day limit).
**How to avoid:** This is by design (D-06). Document it clearly. Tyler's CRM should handle 429 responses gracefully. Consider logging a warning when tokens drop below 10%.
**Warning signs:** Tyler reports all sends failing after a burst.

### Pitfall 5: Zod v4 Import Path Change
**What goes wrong:** Importing `z` from `'zod'` instead of `'zod/v4'` when using Zod 4.x.
**Why it happens:** Zod 4 ships both v3-compatible and v4 APIs. The package.json shows zod 4.3.6.
**How to avoid:** Check how Phase 2 imports Zod. If `env.ts` uses `import { z } from 'zod'`, follow the same pattern for consistency. If it needs `'zod/v4'`, use that everywhere.
**Warning signs:** Type errors or missing Zod methods at compile time.

## Code Examples

### BlueBubbles Send Message API Call
```typescript
// Source: BB Postman docs + official REST API docs
// POST /api/v1/message/text?password=<pw>
// Request:
{
  "chatGuid": "any;-;+12135551234",  // "any" tries iMessage then SMS
  "tempGuid": "temp-550e8400-e29b-41d4-a716-446655440000",
  "message": "Hello from the API"
}

// Response (200):
{
  "status": 200,
  "message": "Message sent!",
  "data": {
    "guid": "8349E621-252B-4079-9A37-24238EDF8BDF",
    "text": "Hello from the API",
    "isFromMe": true,
    "dateCreated": 1772642539012,
    "handle": {
      "address": "+12135551234",
      "service": "iMessage"  // or "SMS"
    }
  }
}
```

### Error Handler Upgrade Pattern
```typescript
// src/middleware/error-handler.ts -- upgraded from Phase 2
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';
import { AppError } from '../types/errors.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error({ err, req }, 'Unhandled error');

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code,
        retryable: err.retryable,
      },
    });
    return;
  }

  // Fallback for unexpected errors (SECR-04: never expose raw message for 500s)
  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      retryable: false,
    },
  });
}
```

### Error Codes Constant Object
```typescript
// src/types/error-codes.ts
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_PHONE: 'INVALID_PHONE',
  RATE_LIMITED: 'RATE_LIMITED',
  BB_OFFLINE: 'BB_OFFLINE',
  BB_IMESSAGE_DISCONNECTED: 'BB_IMESSAGE_DISCONNECTED',
  SEND_FAILED: 'SEND_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
```

### Env Schema Extension for Rate Limiting
```typescript
// Add to src/config/env.ts envSchema
RATE_LIMIT_CAPACITY: z.string().default('100').transform(Number),
RATE_LIMIT_REFILL_PER_HOUR: z.string().default('4').transform(Number),
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| axios for HTTP | Node native fetch | Node 21+ (stable) | Zero dependency HTTP client, covers BB API needs |
| express-rate-limit middleware | Custom token bucket in service layer | N/A (project-specific) | express-rate-limit is per-IP/per-route; we need per-instance with custom jitter |
| zod v3 `import { z } from 'zod'` | zod v4 (check import path) | zod 4.0 (2025) | v4 has new import path `zod/v4` but v3 compat path still works |

**Deprecated/outdated:**
- `axios`: Still maintained but unnecessary when native fetch covers the use case and Node 24 is the runtime.
- `node-fetch`: Completely unnecessary on Node 24 -- native fetch is stable.

## Open Questions

1. **Fire-and-forget vs synchronous send with jitter**
   - What we know: Jitter delays (2-90s) mean the BB API call happens well after the HTTP request arrives. The response should not block for this long.
   - What's unclear: Should POST /send return immediately with a `tempGuid` as messageId (before BB confirms), or wait for BB's response after the jitter delay?
   - Recommendation: Return immediately with `tempGuid` as messageId and `status: "queued"`. The jitter + BB call happens asynchronously. If the BB call fails, it's logged but the client already has the "queued" response. This matches the "queued" semantics of SEND-03 and avoids 2-90s response times. Tyler's CRM can check delivery status later (Phase 5 via webhooks).

2. **iMessage disconnection detection in send path**
   - What we know: D-11 says detect via BB API health response. D-03 defines `BB_IMESSAGE_DISCONNECTED` error.
   - What's unclear: Should the send service proactively check BB health before every send, or only detect disconnection from BB's error response?
   - Recommendation: Do NOT health-check before every send (adds latency). Instead, if BB returns an error indicating iMessage disconnection, throw `BB_IMESSAGE_DISCONNECTED`. The health endpoint (Phase 7) handles proactive detection. The send path only needs reactive detection.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEND-01 | POST /send returns messageId and queued status | integration | `npx vitest run src/routes/__tests__/send.test.ts -t "returns messageId"` | Wave 0 |
| SEND-02 | Invalid phone returns INVALID_PHONE error | unit + integration | `npx vitest run src/routes/__tests__/send.test.ts -t "invalid phone"` | Wave 0 |
| SEND-02 | BB offline returns BB_OFFLINE error | unit | `npx vitest run src/services/__tests__/bluebubbles.test.ts -t "offline"` | Wave 0 |
| SEND-03 | Response status is "queued" not "delivered" | integration | `npx vitest run src/routes/__tests__/send.test.ts -t "queued"` | Wave 0 |
| SETUP-06 | Rate limiter rejects when tokens exhausted | unit | `npx vitest run src/services/__tests__/rate-limiter.test.ts -t "exhausted"` | Wave 0 |
| SETUP-06 | Jitter delay values are within expected range | unit | `npx vitest run src/services/__tests__/rate-limiter.test.ts -t "jitter"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/types/__tests__/error-codes.test.ts` -- covers error code type safety
- [ ] `src/services/__tests__/bluebubbles.test.ts` -- covers BB client offline detection, send, response parsing
- [ ] `src/services/__tests__/rate-limiter.test.ts` -- covers token bucket consume, refill, jitter ranges
- [ ] `src/routes/__tests__/send.test.ts` -- covers POST /send integration (mock BB client)
- [ ] `src/middleware/__tests__/error-handler.test.ts` -- extend existing tests for AppError with code + retryable

## Sources

### Primary (HIGH confidence)
- [BlueBubbles REST API Docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) -- Authentication via query param, response format
- [BlueBubbles Postman Collection](https://documenter.getpostman.com/view/765844/UV5RnfwM) -- Send message endpoint details
- [BlueBubbles Setup Gist](https://gist.github.com/hmseeb/e313cd954ad893b75433f2f2db0fb704) -- Verified POST /api/v1/message/text request/response format, chat GUID format `any;-;+<phone>`
- Node 24.3.0 runtime verified locally -- native fetch and crypto.randomUUID() confirmed available

### Secondary (MEDIUM confidence)
- [Token Bucket Rate Limiting in Node.js](https://oneuptime.com/blog/post/2026-01-25-token-bucket-rate-limiting-nodejs/view) -- Implementation patterns
- [Token Bucket Algorithm](https://kendru.github.io/javascript/2018/12/28/rate-limiting-in-javascript-with-a-token-bucket/) -- Core algorithm reference

### Tertiary (LOW confidence)
- Apple ~100 messages/day spam threshold -- community-reported, no official Apple documentation. Used as basis for default token capacity but should be validated empirically.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all dependencies already installed from Phase 2, native fetch verified on Node 24.3.0
- Architecture: HIGH -- extends established Phase 2 patterns (layered services, Zod validation, error handler)
- Pitfalls: HIGH -- BB API format verified against multiple sources, credential leak risk documented with mitigation
- Rate limiting: MEDIUM -- token bucket algorithm is well-understood but the Apple ~100/day threshold is community-reported

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable domain, no fast-moving dependencies)
