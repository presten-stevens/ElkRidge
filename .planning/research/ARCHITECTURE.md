# Architecture Patterns

**Domain:** iMessage API wrapper service
**Researched:** 2026-03-30

## Recommended Architecture

```
Tyler's CRM
    |
    | HTTPS (Bearer token auth)
    v
[Nginx] -- SSL termination, rate limiting
    |
    | HTTP (localhost:3000)
    v
[Express API Wrapper] -- Our code
    |
    | HTTP (localhost:1234, ?password=xxx)
    v
[BlueBubbles Server] -- Community project
    |
    | macOS Private APIs / Messages.app
    v
[iMessage / Apple ID]
```

**Webhook flow (inbound messages):**
```
iPhone receives iMessage
    -> Apple servers -> Mac Messages.app
    -> BlueBubbles detects new message
    -> BlueBubbles POSTs to our webhook receiver (localhost:3000/webhooks/bluebubbles)
    -> Our service transforms + relays to Tyler's CRM webhook URL
    -> If CRM returns non-2xx: retry with exponential backoff
    -> Update last_synced_at on success
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Nginx | SSL termination, reverse proxy, basic rate limiting | Express API (downstream) |
| Express API (our code) | Auth, validation, routing, error handling, response normalization | Nginx (upstream), BlueBubbles (downstream), Tyler's CRM (webhook relay) |
| BlueBubbles Client Service | Axios wrapper for BB API, error translation, response normalization | BlueBubbles Server |
| Webhook Receiver | Accepts POSTs from BlueBubbles, validates event shape | BlueBubbles Server (inbound), Webhook Relay (internal) |
| Webhook Relay | Delivers events to Tyler's CRM URL, manages retry queue | Tyler's CRM (outbound) |
| Health Monitor | Periodic BB health checks, downtime detection, alert dispatch | BlueBubbles Server, Alert URL |
| Sync State | Read/write `last_synced_at` to JSON file | Local filesystem |
| Config | Zod-validated env vars, instance-specific settings | All components read from config |

### Data Flow

**Outbound message (Tyler sends):**
1. CRM -> `POST /send` with `{ to: "+1234567890", body: "Hello" }`
2. Auth middleware validates Bearer token
3. Zod validates request body
4. BlueBubbles client calls `POST /api/v1/message/text?password=xxx` with `{ chatGuid: "iMessage;-;+1234567890", message: "Hello" }`
5. BB returns message object with guid
6. We return `{ messageId: "guid", status: "sent", timestamp: "..." }`

**Inbound message (Tyler receives):**
1. BlueBubbles detects new message in Messages.app
2. BB POSTs to `http://localhost:3000/webhooks/bluebubbles` with event payload
3. Webhook receiver validates event shape, extracts relevant fields
4. Webhook relay POSTs to Tyler's configured CRM URL: `{ from: "+1234567890", body: "Hi there", timestamp: "...", threadId: "..." }`
5. If CRM returns 2xx: update `last_synced_at`, done
6. If CRM returns non-2xx: add to retry queue with exponential backoff

## Patterns to Follow

### Pattern 1: Service Layer Abstraction
**What:** All BlueBubbles API calls go through a single `BlueBubblesClient` class. No route handler calls BB directly.
**When:** Always. Every interaction with BlueBubbles.
**Why:** BB's API has quirks (query param auth, inconsistent response shapes). Isolate them.
**Example:**
```typescript
// services/bluebubbles.ts
class BlueBubblesClient {
  private baseUrl: string;
  private password: string;
  private http: AxiosInstance;

  constructor(config: BBConfig) {
    this.baseUrl = config.blueBubblesUrl;
    this.password = config.blueBubblesPassword;
    this.http = axios.create({
      baseURL: this.baseUrl,
      params: { password: this.password },
      timeout: 10_000,
    });
  }

  async sendMessage(to: string, body: string): Promise<NormalizedMessage> {
    const chatGuid = `iMessage;-;${to}`;
    const res = await this.http.post('/api/v1/message/text', {
      chatGuid,
      message: body,
    });
    return normalizeMessage(res.data.data);
  }
}
```

### Pattern 2: Config-as-Schema
**What:** All environment variables validated at startup with zod. Fail fast if config is wrong.
**When:** Application boot.
**Why:** Multi-instance means different `.env` files. Catch misconfiguration immediately, not at runtime.
**Example:**
```typescript
// config.ts
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production']).default('production'),
  API_KEY: z.string().min(32, 'API key must be at least 32 characters'),
  BLUEBUBBLES_URL: z.string().url().default('http://localhost:1234'),
  BLUEBUBBLES_PASSWORD: z.string().min(1),
  WEBHOOK_URL: z.string().url(),
  ALERT_URL: z.string().url().optional(),
  DOWNTIME_THRESHOLD_MS: z.coerce.number().default(300_000), // 5 min
  WEBHOOK_MAX_RETRIES: z.coerce.number().default(5),
  INSTANCE_NAME: z.string().default('default'),
});

export const config = configSchema.parse(process.env);
export type Config = z.infer<typeof configSchema>;
```

### Pattern 3: Exponential Backoff Retry
**What:** Failed webhook deliveries retry with increasing delays.
**When:** Tyler's CRM returns non-2xx or times out.
**Why:** CRM might be temporarily down. Don't lose messages. Don't hammer the endpoint.
**Example:**
```typescript
// Delays: 1s, 2s, 4s, 8s, 16s (capped)
const delay = Math.min(1000 * Math.pow(2, attempt), 16_000);
```

### Pattern 4: Graceful Degradation
**What:** If BlueBubbles is unreachable, health endpoint reports degraded status, alerts fire, but Express stays up.
**When:** BlueBubbles crashes, Mac disconnects, iMessage signs out.
**Why:** The API wrapper should never crash because BB is down. It should report the problem.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Direct BlueBubbles Calls in Route Handlers
**What:** Calling `axios.get('http://localhost:1234/api/v1/...')` directly in Express route handlers.
**Why bad:** BB's auth mechanism, error shapes, and response formats leak into routing layer. Impossible to mock for testing.
**Instead:** Always go through `BlueBubblesClient` service.

### Anti-Pattern 2: Hardcoded Instance Values
**What:** `const PORT = 3000` or `const BB_URL = 'http://localhost:1234'` in source code.
**Why bad:** Breaks multi-instance. Every phone number needs different ports, different BB servers.
**Instead:** All values from env vars, validated by zod config schema.

### Anti-Pattern 3: Synchronous File I/O for Sync State
**What:** Using `fs.readFileSync` / `fs.writeFileSync` for `last_synced_at`.
**Why bad:** Blocks the event loop. Under load (many webhooks), this stalls all requests.
**Instead:** Use `fs.promises.readFile` / `fs.promises.writeFile` with a simple in-memory cache.

### Anti-Pattern 4: Storing Messages
**What:** Caching or persisting message content in our service.
**Why bad:** Project explicitly requires no database. Tyler handles persistence. Storing messages creates data liability.
**Instead:** Pass through and forget. Only store `last_synced_at` timestamp.

### Anti-Pattern 5: Clustering with PM2
**What:** Running multiple Express instances for "performance" via PM2 cluster mode.
**Why bad:** One Express instance per phone number is the correct model. Clustering introduces shared state problems with the webhook retry queue and `last_synced_at`.
**Instead:** `instances: 1` in PM2 config. Scale by adding more phone numbers (more PM2 apps), not more workers.

## Scalability Considerations

| Concern | 1 phone number | 5 phone numbers | 20 phone numbers |
|---------|---------------|-----------------|-------------------|
| Compute | Single Mac Mini / EC2 Mac | Single Mac, 5 PM2 processes | Multiple Macs, load balanced by phone |
| Memory | ~50-100MB per Express instance | ~250-500MB total | Separate machines |
| BB Server | One BB server per phone/Apple ID | 5 BB servers, different ports | Separate machines per BB |
| Nginx | One config, one SSL cert | One nginx, 5 upstream blocks | Per-machine nginx |
| Monitoring | Single health endpoint | Aggregate health across instances | Centralized monitoring needed |

**The ceiling:** Each Mac can realistically run 3-5 BlueBubbles instances (each needs its own Messages.app session). Beyond that, add more Macs.

## Sources

- [BlueBubbles REST API](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks)
- [BlueBubbles Webhook Docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks)
- [Express 5 Error Handling](https://expressjs.com/)
- [PM2 Ecosystem File](https://pm2.keymetrics.io/docs/usage/quick-start/)
