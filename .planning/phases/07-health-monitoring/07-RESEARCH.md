# Phase 7: Health & Monitoring - Research

**Researched:** 2026-03-30
**Domain:** Health check endpoint, periodic polling, downtime alerting
**Confidence:** HIGH

## Summary

This phase adds a GET /health endpoint that queries the BlueBubbles server info API to report real-time status, a periodic health polling service that detects silent failures (iMessage sign-outs, BB disconnects), and a downtime alerting mechanism that POSTs to a configurable webhook URL when consecutive failures cross a threshold.

The BlueBubbles `/api/v1/server/info` endpoint returns a `ServerMetadataResponse` object that includes `os_version` (macOS version string), `server_version` (BB version), `detected_imessage` (iMessage account email/ID or null if not authenticated), `private_api` (boolean), and `helper_connected` (boolean). This is the single source of truth for all health status fields -- no need to call multiple BB endpoints or use `node:os` for macOS version. The existing `BlueBubblesClient.request<T>()` method can query this endpoint directly.

**Primary recommendation:** Query BB `/api/v1/server/info` for all health data. Use `setInterval` with `.unref()` for polling (matching dedup pattern). POST alerts via native `fetch` (matching webhook-relay pattern). Three new files: `health.ts` (check logic), `health-monitor.ts` (polling + alerting), `routes/health.ts` (thin route).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: GET /health returns JSON: `{ status: "healthy"|"degraded"|"down", bluebubbles: { status: string, version: string }, imessage: { authenticated: boolean }, system: { macosVersion: string }, timestamp: string }`
- D-02: "healthy" = BB reachable + iMessage authenticated. "degraded" = BB reachable but iMessage not authenticated. "down" = BB unreachable.
- D-03: BB version and macOS version obtained from BB's server info API endpoint (HLTH-02).
- D-04: Health endpoint does NOT require auth -- it is a status page.
- D-05: Poll BB health every 60 seconds (configurable via `HEALTH_POLL_INTERVAL_MS` env var, default 60000).
- D-06: Use setInterval with `.unref()` for graceful shutdown, consistent with dedup and retry patterns.
- D-07: Track consecutive failure count. Reset to 0 on successful check.
- D-08: Alert fires after `ALERT_AFTER_FAILURES` consecutive failed health checks (default 2, configurable via env).
- D-09: POST to `ALERT_WEBHOOK_URL` with payload: `{ type: "downtime_alert", service: "bluebubbles"|"imessage", status: string, message: string, timestamp: string }`.
- D-10: If `ALERT_WEBHOOK_URL` is not configured, log warning and skip alerting (same pattern as CRM webhook).
- D-11: Don't re-alert on every poll -- alert once when threshold is crossed, then again only after recovery + re-failure.
- D-12: Health check logic in `src/services/health.ts`.
- D-13: Health polling + alerting in `src/services/health-monitor.ts`.
- D-14: Route in `src/routes/health.ts`.
- D-15: Initialize health monitor in `src/server.ts` after other services.

### Claude's Discretion
- Exact BB API endpoint for server info/health (researcher will verify) -- RESOLVED: `/api/v1/server/info`
- How to obtain macOS version (node:os or BB API) -- RESOLVED: BB API returns `os_version`
- Whether to add a `lastChecked` field to health response -- RECOMMENDED: yes, include it
- Test mocking strategy for health checks

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HLTH-01 | GET /health returns real-time status of BB service, iPhone connection, iMessage auth state | BB `/api/v1/server/info` returns `detected_imessage`, `helper_connected`, and connection reachability covers all three status dimensions |
| HLTH-02 | Health endpoint includes macOS version and BlueBubbles version | BB `/api/v1/server/info` returns `os_version` and `server_version` directly |
| HLTH-03 | Downtime alerting -- POST to configurable alert URL if service offline beyond threshold | Native `fetch` POST to `ALERT_WEBHOOK_URL` (already in env schema), consecutive failure counter with configurable threshold |
| HLTH-04 | Periodic health polling to detect iMessage sign-out or BB disconnect proactively | `setInterval` with `.unref()` pattern (matches dedup.ts), polls BB server info and checks `detected_imessage` field |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:os | built-in | NOT NEEDED -- BB API provides macOS version | Avoid; BB is authoritative source |
| native fetch | built-in | Alert webhook POST | Same pattern as webhook-relay.ts |
| zod | 4.3.x (installed) | Validate BB server info response shape | Catches BB API breaking changes early |

### Supporting
No new dependencies required. This phase uses only what is already installed.

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended File Structure
```
src/
  services/
    health.ts           # checkHealth() -- queries BB, returns HealthStatus
    health-monitor.ts   # HealthMonitor -- polling loop, alert logic
  routes/
    health.ts           # GET /health thin handler
  types/
    health.ts           # HealthStatus, HealthResponse, AlertPayload types
```

### Pattern 1: Health Check Service (health.ts)
**What:** A pure function `checkHealth(client: BlueBubblesClient): Promise<HealthStatus>` that queries BB `/api/v1/server/info`, maps the response to the D-01 health response shape, and catches errors (BB_OFFLINE maps to "down" status).
**When to use:** Called by both the GET /health route handler and the periodic health monitor.
**Example:**
```typescript
// Source: BB server source (generalInterface.ts -> getServerMetadata)
// BB /api/v1/server/info returns:
interface BBServerInfo {
  computer_id: string;
  os_version: string;           // e.g. "15.3.1"
  server_version: string;       // e.g. "1.9.9"
  private_api: boolean;
  proxy_service: string;
  helper_connected: boolean;
  detected_icloud: string | null;
  detected_imessage: string | null;  // email/ID or null if not authenticated
  macos_time_sync: boolean;
  local_ipv4s: string[];
  local_ipv6s: string[];
}

// Our health response (per D-01, D-02):
interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  bluebubbles: { status: string; version: string };
  imessage: { authenticated: boolean };
  system: { macosVersion: string };
  timestamp: string;
  lastChecked: string | null;  // discretion: include last poll time
}
```

### Pattern 2: Health Monitor (health-monitor.ts)
**What:** Singleton service with `init()` and `shutdown()` that runs `setInterval` to poll health, tracks consecutive failures, and fires alerts.
**When to use:** Initialized once in server.ts after other services.
**Example:**
```typescript
// Follows dedup.ts .unref() pattern exactly
let timer: ReturnType<typeof setInterval>;
let consecutiveFailures = 0;
let alertFired = false;  // prevents re-alerting until recovery (D-11)

function init(client: BlueBubblesClient): void {
  timer = setInterval(() => pollHealth(client), env.HEALTH_POLL_INTERVAL_MS);
  timer.unref();
}
```

### Pattern 3: Alert State Machine (D-11 compliance)
**What:** Three-state machine: HEALTHY -> ALERTING -> ALERTED. Alert fires only on HEALTHY->ALERTING transition. Resets to HEALTHY on successful check.
**When to use:** Prevents alert spam -- fires once when threshold crossed, stays quiet until service recovers and fails again.
**States:**
- `consecutiveFailures < threshold` = HEALTHY (no alert)
- `consecutiveFailures === threshold` = fire alert, set `alertFired = true`
- `consecutiveFailures > threshold && alertFired` = stay quiet
- Successful check = reset `consecutiveFailures = 0`, `alertFired = false`

### Pattern 4: Separate BB and iMessage Alerts (D-09)
**What:** The alert payload includes a `service` field distinguishing BB-level vs iMessage-level failures.
**When to use:** BB unreachable = `service: "bluebubbles"`. BB reachable but iMessage not authenticated = `service: "imessage"`.
**Logic:**
- If BB request throws (catch block) -> service is "bluebubbles", status is "down"
- If BB responds but `detected_imessage` is null -> service is "imessage", status is "degraded"

### Anti-Patterns to Avoid
- **Shallow health check:** Do NOT just return 200 from Express. Must actually query BB to detect silent failures.
- **Alerting on every poll failure:** D-11 explicitly forbids this. Must track state to alert once.
- **Using node:os for macOS version:** BB API already provides this. Using node:os would report the version of the machine running our wrapper, which is the same machine, but BB is the authoritative source per D-03.
- **Blocking health check in route handler:** The route should call `checkHealth()` which has a 10-second timeout (via AbortSignal.timeout on the fetch). Don't let a hanging BB server block Express indefinitely.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP POST for alerts | Custom HTTP client | Native `fetch` with `AbortSignal.timeout` | Same proven pattern as webhook-relay.ts |
| BB server info parsing | Manual field extraction | Zod schema with `.safeParse()` | Catches BB API shape changes before they cause runtime errors |
| Timer cleanup on shutdown | Manual clearInterval tracking | `.unref()` + singleton destroy pattern | Already established in dedup.ts |

## Common Pitfalls

### Pitfall 1: BB Returns 200 But iMessage Is Disconnected
**What goes wrong:** Health check reports "healthy" because BB server is reachable, but iMessage is actually signed out. Tyler misses messages for hours.
**Why it happens:** BB server runs independently of iMessage. The server can be up while iMessage auth has expired.
**How to avoid:** Always check `detected_imessage` field from server info. If null, status is "degraded" not "healthy" (per D-02).
**Warning signs:** `detected_imessage` is null or empty string in BB response.

### Pitfall 2: Alert Storm on Flaky Network
**What goes wrong:** Brief network hiccup causes a single poll failure, which triggers an alert to Tyler.
**Why it happens:** Threshold too low (1 failure) or no consecutive tracking.
**How to avoid:** D-08 requires threshold of 2+ consecutive failures (default 2). Reset counter on any success.
**Warning signs:** Frequent alert-then-recover cycles in logs.

### Pitfall 3: Alert Webhook Failure Swallowed Silently
**What goes wrong:** The alert POST to ALERT_WEBHOOK_URL fails (URL down, network error), and nobody knows.
**Why it happens:** Alert delivery is fire-and-forget with no retry.
**How to avoid:** Log at `error` level when alert delivery fails. Do NOT add retry logic to alerts (avoid infinite recursion -- alerting about alert failures). A logged error is sufficient -- if Tyler's alert endpoint is down, that is a separate problem.
**Warning signs:** Error logs about alert delivery failures.

### Pitfall 4: Health Route Mounted Behind Auth Middleware
**What goes wrong:** GET /health returns 401 because Phase 8 adds auth middleware to all routes.
**Why it happens:** Health route registered after auth middleware in the router chain.
**How to avoid:** D-04 explicitly says health endpoint does NOT require auth. Mount health route BEFORE auth middleware in app.ts/routes. Document this for Phase 8 implementer.
**Warning signs:** Health endpoint returns 401 after Phase 8 is implemented.

### Pitfall 5: Timer Leak on Multiple init() Calls
**What goes wrong:** Calling `init()` twice creates two intervals, doubling poll frequency.
**Why it happens:** No guard against re-initialization.
**How to avoid:** Check if timer already exists in `init()`, clear old timer before creating new one. Or throw if already initialized.

## Code Examples

### BB Server Info Query
```typescript
// Source: BB server source code (generalInterface.ts)
// GET /api/v1/server/info returns ServerMetadataResponse
const info = await client.request<BBServerInfo>('/api/v1/server/info');
// info.os_version = "15.3.1"
// info.server_version = "1.9.9"
// info.detected_imessage = "user@icloud.com" or null
```

### Health Status Mapping (D-02)
```typescript
function mapToHealthStatus(info: BBServerInfo): HealthResponse {
  const authenticated = info.detected_imessage !== null && info.detected_imessage !== '';
  const status = authenticated ? 'healthy' : 'degraded';
  return {
    status,
    bluebubbles: { status: 'connected', version: info.server_version },
    imessage: { authenticated },
    system: { macosVersion: info.os_version },
    timestamp: new Date().toISOString(),
    lastChecked: null, // updated by monitor
  };
}
// If BB request throws -> status: 'down', with fallback empty values
```

### Alert POST (D-09, D-10)
```typescript
// Same pattern as webhook-relay.ts deliverOnce
async function sendAlert(payload: AlertPayload): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) {
    logger.warn('ALERT_WEBHOOK_URL not configured, skipping alert');
    return;
  }
  try {
    const res = await fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'Alert delivery to [ALERT_WEBHOOK_URL] failed');
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Alert delivery failed (network)');
  }
}
```

### Env Schema Extension
```typescript
// Add to envSchema in src/config/env.ts
HEALTH_POLL_INTERVAL_MS: z.string().default('60000').transform(Number),
ALERT_AFTER_FAILURES: z.string().default('2').transform(Number),
// ALERT_WEBHOOK_URL already exists as optional
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Return 200 from Express (shallow) | Query actual service + report sub-system status | Industry standard | Catches silent failures that shallow checks miss |
| Alert on every failure | Alert once, suppress until recovery | Standard practice | Prevents alert fatigue |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HLTH-01 | checkHealth returns correct status for healthy/degraded/down states | unit | `npx vitest run src/services/__tests__/health.test.ts -t "checkHealth"` | Wave 0 |
| HLTH-02 | Health response includes macOS version and BB version from server info | unit | `npx vitest run src/services/__tests__/health.test.ts -t "version"` | Wave 0 |
| HLTH-03 | Alert fires after N consecutive failures, POST matches D-09 shape | unit | `npx vitest run src/services/__tests__/health-monitor.test.ts -t "alert"` | Wave 0 |
| HLTH-04 | Periodic polling calls checkHealth on interval, resets on success | unit | `npx vitest run src/services/__tests__/health-monitor.test.ts -t "poll"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/health.test.ts` -- covers HLTH-01, HLTH-02
- [ ] `src/services/__tests__/health-monitor.test.ts` -- covers HLTH-03, HLTH-04
- [ ] `src/routes/__tests__/health.test.ts` -- integration test for GET /health route (supertest)

### Test Mocking Strategy (Discretion Item)
- **BlueBubblesClient:** Mock `client.request<BBServerInfo>()` to return canned server info responses (healthy, degraded, throw for down).
- **fetch (alert POST):** Use `vi.stubGlobal('fetch', mockFetch)` to intercept alert POST calls.
- **setInterval:** Use `vi.useFakeTimers()` to advance time and trigger poll callbacks without waiting.
- **env vars:** Override `env.HEALTH_POLL_INTERVAL_MS` and `env.ALERT_AFTER_FAILURES` in test setup.

## Open Questions

1. **BB server info when private API is disabled**
   - What we know: `helper_connected` indicates private API helper status. `detected_imessage` should still be populated from the Messages database regardless of private API setting.
   - What's unclear: Whether `detected_imessage` can return an empty string vs null when iMessage is configured but signed out.
   - Recommendation: Treat both null and empty string as "not authenticated" (D-02 degraded). Test against live BB instance during Phase 1 verification.

2. **lastChecked field (discretion item)**
   - What we know: The health monitor knows when it last polled successfully.
   - Recommendation: Include `lastChecked: string | null` in health response. Set to ISO timestamp of last successful poll. null before first poll completes. This helps Tyler distinguish "just started, haven't checked yet" from "checked 5 seconds ago."

## Sources

### Primary (HIGH confidence)
- BlueBubbles server source code: `generalInterface.ts` -> `getServerMetadata()` -- exact response shape verified from GitHub repo source
- BlueBubbles server source code: `ServerMetadataResponse` type -- confirmed fields: `os_version`, `server_version`, `detected_imessage`, `helper_connected`, `private_api`
- Existing codebase: `src/services/dedup.ts` -- `.unref()` timer pattern
- Existing codebase: `src/services/webhook-relay.ts` -- alert POST pattern (fetch + AbortSignal.timeout)
- Existing codebase: `src/config/env.ts` -- `ALERT_WEBHOOK_URL` already in schema

### Secondary (MEDIUM confidence)
- [BlueBubbles REST API Docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) -- endpoint structure
- [BlueBubbles Postman Collection](https://documenter.getpostman.com/view/765844/UV5RnfwM) -- API examples

### Tertiary (LOW confidence)
- Behavior of `detected_imessage` when iMessage is signed out (null vs empty string) -- needs live BB testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns exist in codebase
- Architecture: HIGH -- file structure and patterns dictated by CONTEXT.md decisions
- Pitfalls: HIGH -- sourced from BB server source code analysis and existing codebase patterns
- BB API shape: HIGH -- verified directly from BlueBubbles server source code on GitHub

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable -- no fast-moving dependencies)
