# Phase 15: Multi-Tenant Architecture - Research

**Researched:** 2026-04-03
**Domain:** Process orchestration, multi-instance management, API gateway patterns
**Confidence:** HIGH

## Summary

The current architecture runs one Express process per phone number, each with its own PM2 entry, `.env` file, port, and nginx server block. This works for a handful of numbers but becomes operationally painful at 20+ instances (20 env files, 20 PM2 entries, 20 nginx blocks, no unified health view). Phase 15 introduces a management layer that centralizes instance lifecycle, configuration, and health aggregation.

After analyzing the codebase, the recommended approach is a **management process pattern**: a new Express service (the "control plane") that uses PM2's programmatic API to orchestrate existing per-number worker processes. This preserves the current battle-tested single-instance architecture (each worker is still an independent Express process with its own BB connection, socket, dedup buffer, retry queue, and health monitor) while adding centralized management on top. The alternative -- a single process managing multiple BB connections in-process -- would require rewriting every singleton service (getBBClient, initBBEvents, initRelay, initHealthMonitor) to be instance-scoped, a massive refactor with high risk and low payoff.

**Primary recommendation:** Build a separate management API service that reads instance config from a JSON file, uses PM2 programmatic API for lifecycle management, and proxies health checks to aggregate cross-instance status. Keep existing worker processes unchanged.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EOPS-04 | Multi-instance management API (centralized control of multiple phone numbers) | Management API pattern with PM2 programmatic API for lifecycle, JSON config registry for instance definitions, aggregated health endpoint |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pm2 | 5.x (latest) | Programmatic process lifecycle management | Already used for deployment; programmatic API enables start/stop/list/describe from code |
| express | ^5.2.1 | Management API HTTP server | Same framework as existing workers -- consistency |
| zod | ^4.3.6 | Config and request validation | Already used project-wide |
| pino | ^10.3.1 | Structured logging | Already used project-wide |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chokidar | 4.x | Watch instances.json for live config changes | Optional -- only if hot-reload of config is desired |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PM2 programmatic API | child_process.fork() | Loses PM2 restart policies, log rotation, startup persistence -- not worth it |
| Separate management process | Single process with multiple BB connections | Would require rewriting all singleton services (BBClient, bb-events, webhook-relay, health-monitor) to be instance-scoped -- massive refactor for marginal benefit |
| JSON config file | SQLite database | Overkill for tens of instances; JSON is human-editable and git-trackable |

**Installation:**
```bash
npm install pm2
```

Note: pm2 is already a global CLI dependency. Adding it as a project dependency enables the programmatic `require('pm2')` / `import pm2 from 'pm2'` API.

## Architecture Patterns

### Recommended Project Structure
```
src/
  manager/                 # New management plane (separate entry point)
    server.ts              # Management API entry point
    app.ts                 # Express app factory for management routes
    config/
      instances.ts         # Load and validate instances.json
    routes/
      instances.ts         # CRUD-ish instance management endpoints
      health.ts            # Aggregated health endpoint
    services/
      pm2-manager.ts       # PM2 programmatic API wrapper
      instance-health.ts   # Per-instance health proxy
    types/
      instance.ts          # Instance config and status types
  ...existing worker code (unchanged)
config/
  instances.json           # Instance registry (source of truth)
ecosystem.config.js        # Generated from instances.json (or kept manual)
```

### Pattern 1: Management Process + Worker Processes

**What:** A dedicated management API process that orchestrates independent worker processes via PM2's programmatic API. The manager reads instance definitions from `instances.json`, can start/stop/restart workers, and aggregates health by proxying each worker's `/health` endpoint.

**When to use:** When existing worker code is built around singletons and module-level state (which this project is).

**Architecture:**
```
                    +-------------------+
                    | Management API    |
                    | (Express, port    |
                    |  4000)            |
                    +--------+----------+
                             |
                    PM2 Programmatic API
                             |
            +----------------+----------------+
            |                |                |
   +--------v------+ +------v--------+ +-----v---------+
   | Worker: Phone1| | Worker: Phone2| | Worker: Phone3|
   | Port 3000     | | Port 3001     | | Port 3002     |
   | BB @ :1234    | | BB @ :1235    | | BB @ :1236    |
   +---------------+ +---------------+ +---------------+
```

### Pattern 2: Instance Registry (instances.json)

**What:** A single JSON file that defines all phone number instances, replacing the pattern of N separate .env files + manual ecosystem.config.js entries.

**Example:**
```json
{
  "instances": [
    {
      "id": "tyler-iphone",
      "phoneNumber": "+18015551234",
      "port": 3000,
      "bluebubbles": {
        "url": "http://localhost:1234",
        "password": "encrypted-or-env-ref"
      },
      "apiKey": "env:API_KEY_TYLER_IPHONE",
      "crmWebhookUrl": "https://crm.example.com/webhook/iphone",
      "alertWebhookUrl": "https://alerts.example.com/iphone",
      "enabled": true
    },
    {
      "id": "tyler-android",
      "phoneNumber": "+18015555678",
      "port": 3001,
      "bluebubbles": {
        "url": "http://localhost:1235",
        "password": "encrypted-or-env-ref"
      },
      "apiKey": "env:API_KEY_TYLER_ANDROID",
      "crmWebhookUrl": "https://crm.example.com/webhook/android",
      "alertWebhookUrl": "https://alerts.example.com/android",
      "enabled": true
    }
  ]
}
```

**Key design choice:** Passwords and API keys should use `env:VAR_NAME` references rather than storing secrets directly in JSON. The manager resolves these from environment variables at startup. This keeps `instances.json` committable to git.

### Pattern 3: PM2 Programmatic Lifecycle

**What:** Wrapping PM2's callback-based API in Promise-based methods for clean async/await usage.

**Example:**
```typescript
import pm2 from 'pm2';

function connectPM2(): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => (err ? reject(err) : resolve()));
  });
}

function startProcess(config: PM2StartOptions): Promise<pm2.ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.start(config, (err, proc) => (err ? reject(err) : resolve(proc)));
  });
}

function listProcesses(): Promise<pm2.ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => (err ? reject(err) : resolve(list)));
  });
}

function stopProcess(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.stop(name, (err) => (err ? reject(err) : resolve()));
  });
}

function deleteProcess(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.delete(name, (err) => (err ? reject(err) : resolve()));
  });
}

function describeProcess(name: string): Promise<pm2.ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.describe(name, (err, desc) => (err ? reject(err) : resolve(desc)));
  });
}
```

### Pattern 4: Aggregated Health

**What:** The management API's `/health` endpoint calls each worker's `/health` endpoint and merges results.

**Example response:**
```json
{
  "status": "degraded",
  "instances": {
    "tyler-iphone": {
      "status": "healthy",
      "bluebubbles": { "status": "connected", "version": "1.9.6" },
      "imessage": { "authenticated": true },
      "port": 3000,
      "pm2Status": "online",
      "uptime": 86400
    },
    "tyler-android": {
      "status": "down",
      "bluebubbles": { "status": "unreachable", "version": "" },
      "imessage": { "authenticated": false },
      "port": 3001,
      "pm2Status": "errored",
      "uptime": 0
    }
  },
  "summary": {
    "total": 2,
    "healthy": 1,
    "degraded": 0,
    "down": 1
  },
  "timestamp": "2026-04-03T12:00:00.000Z"
}
```

**Aggregation logic:** Overall status is `healthy` if all instances healthy, `degraded` if any degraded or some down, `down` if all down.

### Anti-Patterns to Avoid
- **In-process multi-tenancy with singletons:** The current codebase uses module-level singletons (`getBBClient`, `initBBEvents`, `initRelay`). Converting these to instance-scoped would touch every service file and risk breaking working code.
- **Dynamic nginx config generation:** Generating and reloading nginx from the management API adds fragility. Keep nginx config manual or use a simple template script run by operators.
- **Storing secrets in instances.json:** Use environment variable references (`env:VAR_NAME`) instead. Keeps the file safe to commit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process lifecycle management | Custom child_process spawner | PM2 programmatic API | Restart policies, log management, startup persistence, process monitoring all built-in |
| Port allocation | Custom port finder | Sequential assignment from config | Predictable, debuggable, no race conditions |
| Config file watching | fs.watch polling loop | chokidar (if needed) | Cross-platform, handles edge cases; but manual reload via API endpoint is simpler |
| Secret management | Custom encryption | env: references in JSON + process.env | Leverages existing OS-level secret management |

**Key insight:** The management layer should be thin -- it is an API over PM2 and a health aggregator, not a reimplementation of process management.

## Common Pitfalls

### Pitfall 1: PM2 Daemon Connection Lifecycle
**What goes wrong:** PM2 programmatic API connects to the PM2 daemon. If you call `pm2.disconnect()` after each operation, you may lose daemon connection state. If you never disconnect, the management process holds the connection indefinitely.
**Why it happens:** PM2's API is callback-based and designed for scripts that connect-operate-disconnect, not long-running servers.
**How to avoid:** Connect once at management server startup, keep the connection open for the lifetime of the management process. Only disconnect on graceful shutdown.
**Warning signs:** "PM2 not connected" errors, operations silently failing.

### Pitfall 2: Port Conflicts
**What goes wrong:** Two instances configured with the same port, or a new instance assigned a port already in use.
**Why it happens:** Manual config without validation.
**How to avoid:** Validate `instances.json` at startup -- check for duplicate ports, duplicate IDs, and port range validity. The Zod schema should enforce uniqueness via `.superRefine()`.
**Warning signs:** EADDRINUSE errors in worker logs.

### Pitfall 3: Env File Generation vs. Direct PM2 env
**What goes wrong:** PM2 start options support `env` object directly, but existing workers load config via `env_file` in ecosystem.config.js, which triggers Zod validation in `env.ts`.
**Why it happens:** Two config loading paths diverge.
**How to avoid:** When the manager starts a worker via PM2 programmatic API, pass environment variables via `pm2.start({ env: { PORT: '3000', BLUEBUBBLES_URL: '...', ... } })`. The worker's `env.ts` reads from `process.env` regardless of source, so this is transparent.
**Warning signs:** Workers failing Zod validation on startup.

### Pitfall 4: Health Check Timeouts Cascading
**What goes wrong:** Aggregated health endpoint calls N workers sequentially; if several are down, the response takes N * timeout seconds.
**Why it happens:** Sequential health checks with per-request timeouts.
**How to avoid:** Use `Promise.allSettled()` to check all instances in parallel. Set a short timeout (3s) per instance health check. Return partial results on timeout.
**Warning signs:** Management `/health` endpoint timing out or being very slow.

### Pitfall 5: Race Between Config Change and PM2 State
**What goes wrong:** Config says instance should be running, but PM2 shows it stopped (or vice versa).
**Why it happens:** PM2 state is the source of truth for runtime, but config is the source of truth for desired state.
**How to avoid:** Reconciliation pattern -- on startup and on config reload, compare desired state (from config) with actual state (from PM2 list) and converge. Do not assume they match.
**Warning signs:** Ghost processes, instances that restart after being intentionally stopped.

## Code Examples

### Management API Surface

```typescript
// GET /instances -- list all instances with status
// Response: { instances: InstanceStatus[] }

// GET /instances/:id -- single instance detail
// Response: InstanceStatus

// POST /instances/:id/start -- start an instance
// POST /instances/:id/stop -- stop an instance
// POST /instances/:id/restart -- restart an instance

// GET /health -- aggregated health across all instances
// Response: AggregatedHealthResponse

// POST /instances -- add a new instance (writes to instances.json)
// DELETE /instances/:id -- remove an instance (stops + removes from config)
```

### Instance Config Schema (Zod)

```typescript
import { z } from 'zod';

const instanceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), // slug-safe
  phoneNumber: z.string().startsWith('+'), // E.164
  port: z.number().int().min(1024).max(65535),
  bluebubbles: z.object({
    url: z.string().url(),
    password: z.string().min(1), // or env:VAR_NAME reference
  }),
  apiKey: z.string().min(1), // or env:VAR_NAME reference
  crmWebhookUrl: z.string().url().optional(),
  alertWebhookUrl: z.string().url().optional(),
  enabled: z.boolean().default(true),
});

const instancesConfigSchema = z.object({
  instances: z.array(instanceSchema),
}).superRefine((data, ctx) => {
  // Validate no duplicate ports
  const ports = data.instances.map((i) => i.port);
  const dupPort = ports.find((p, idx) => ports.indexOf(p) !== idx);
  if (dupPort) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate port: ${dupPort}`,
    });
  }
  // Validate no duplicate IDs
  const ids = data.instances.map((i) => i.id);
  const dupId = ids.find((id, idx) => ids.indexOf(id) !== idx);
  if (dupId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate instance ID: ${dupId}`,
    });
  }
});
```

### PM2 Worker Start from Manager

```typescript
async function startInstance(instance: InstanceConfig): Promise<void> {
  const envVars = resolveEnvRefs({
    PORT: String(instance.port),
    NODE_ENV: 'production',
    BLUEBUBBLES_URL: instance.bluebubbles.url,
    BLUEBUBBLES_PASSWORD: instance.bluebubbles.password,
    API_KEY: instance.apiKey,
    CRM_WEBHOOK_URL: instance.crmWebhookUrl ?? '',
    ALERT_WEBHOOK_URL: instance.alertWebhookUrl ?? '',
    LOG_LEVEL: 'info',
  });

  await startProcess({
    name: `bb-${instance.id}`,
    script: 'dist/server.js',
    env: envVars,
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
    max_memory_restart: '256M',
  });
}

// Resolve env:VAR_NAME references to actual values
function resolveEnvRefs(vars: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value.startsWith('env:')) {
      const envKey = value.slice(4);
      const envVal = process.env[envKey];
      if (!envVal) throw new Error(`Missing env var: ${envKey} (referenced by ${key})`);
      resolved[key] = envVal;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
```

### Aggregated Health Check

```typescript
async function getAggregatedHealth(instances: InstanceConfig[]): Promise<AggregatedHealth> {
  const checks = await Promise.allSettled(
    instances.map(async (inst) => {
      const res = await fetch(`http://127.0.0.1:${inst.port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      return { id: inst.id, ...data };
    }),
  );

  const results: Record<string, InstanceHealth> = {};
  let healthy = 0, degraded = 0, down = 0;

  for (let i = 0; i < instances.length; i++) {
    const result = checks[i];
    if (result.status === 'fulfilled') {
      results[instances[i].id] = result.value;
      if (result.value.status === 'healthy') healthy++;
      else if (result.value.status === 'degraded') degraded++;
      else down++;
    } else {
      results[instances[i].id] = { status: 'down', error: 'unreachable' };
      down++;
    }
  }

  const overall = down === instances.length ? 'down'
    : (degraded > 0 || down > 0) ? 'degraded'
    : 'healthy';

  return { status: overall, instances: results, summary: { total: instances.length, healthy, degraded, down } };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual N env files + N PM2 entries | Config-driven instance registry with management API | This phase | Eliminates per-instance manual setup |
| Per-instance health checks via curl | Aggregated health endpoint | This phase | Single view of all instances |
| Manual PM2 start/stop per instance | API-driven lifecycle management | This phase | Enables automation and future UI |

## Open Questions

1. **Authentication for the management API**
   - What we know: Worker instances use per-instance API keys. The management API needs its own auth.
   - What's unclear: Should the management API use a separate "admin" API key, or reuse one of the instance keys?
   - Recommendation: Separate `MANAGER_API_KEY` env var with its own Bearer token. Management API is a higher privilege level than individual instance access.

2. **Nginx configuration strategy**
   - What we know: Currently each instance has its own nginx server block with its own domain/subdomain.
   - What's unclear: Should the management API auto-generate nginx config, or keep it manual?
   - Recommendation: Keep nginx manual for now. The management API should NOT touch nginx -- that is an ops task. Future enhancement could add a template generator script, but auto-reload of nginx from an API is risky.

3. **Migration path from current setup**
   - What we know: There is currently one instance (bb-tyler-iphone) running via ecosystem.config.js.
   - What's unclear: How to migrate without downtime.
   - Recommendation: Phase 1 of the plan should create `instances.json` that mirrors the current single-instance setup. The management API starts alongside existing PM2 processes. Migration is additive, not destructive.

4. **Should the management process be a separate npm script / entry point?**
   - What we know: The existing `src/server.ts` is the worker entry point.
   - Recommendation: Yes. `src/manager/server.ts` as a separate entry point, started via its own PM2 process (`bb-manager`). This keeps concerns cleanly separated.

## Project Constraints (from CLAUDE.md)

No CLAUDE.md found in the project root. No additional project-level constraints apply beyond the patterns established in prior phases:
- Express 5 with `express.json()` and Helmet
- Zod for all validation
- Pino structured logging with credential redaction
- AppError pattern for error handling
- Singleton factory pattern for shared services
- PM2 for process management
- 127.0.0.1 binding with nginx reverse proxy
- vitest for testing

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EOPS-04a | Management API lists instances with status | integration | `npx vitest run src/manager/routes/__tests__/instances.test.ts -t "list" -x` | No -- Wave 0 |
| EOPS-04b | New instance provisioned via API/config | integration | `npx vitest run src/manager/routes/__tests__/instances.test.ts -t "provision" -x` | No -- Wave 0 |
| EOPS-04c | Aggregated health across instances | unit | `npx vitest run src/manager/services/__tests__/instance-health.test.ts -x` | No -- Wave 0 |
| EOPS-04d | Independent BB connections per instance | unit | `npx vitest run src/manager/services/__tests__/pm2-manager.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/manager/routes/__tests__/instances.test.ts` -- covers EOPS-04a, EOPS-04b
- [ ] `src/manager/services/__tests__/instance-health.test.ts` -- covers EOPS-04c
- [ ] `src/manager/services/__tests__/pm2-manager.test.ts` -- covers EOPS-04d (mocked PM2 API)
- [ ] PM2 programmatic API: must be mocked in tests (no real daemon in test environment)

## Sources

### Primary (HIGH confidence)
- Project source code: `src/server.ts`, `src/app.ts`, `src/config/env.ts`, `src/services/bluebubbles.ts`, `src/services/bb-events.ts`, `src/services/health-monitor.ts`, `src/services/webhook-relay.ts` -- analyzed singleton patterns and module-level state
- `ecosystem.config.js` and `docs/ONBOARDING.md` -- current multi-instance deployment model
- `.planning/REQUIREMENTS.md` -- EOPS-04 definition
- `.planning/ROADMAP.md` -- Phase 15 success criteria

### Secondary (MEDIUM confidence)
- [PM2 Programmatic API docs](https://pm2.io/docs/runtime/reference/pm2-programmatic/) -- connect, start, list, describe, stop, delete methods
- [PM2 API reference](https://pm2.keymetrics.io/docs/usage/pm2-api/) -- pm2.start options including env object pass-through

### Tertiary (LOW confidence)
- Web search results on multi-tenant Node.js patterns -- general patterns confirmed but applied to this specific codebase architecture through direct code analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Using existing project dependencies plus PM2 programmatic API (already a CLI dependency)
- Architecture: HIGH -- Decision driven by concrete analysis of singleton patterns in current codebase; management process pattern is the path of least resistance
- Pitfalls: MEDIUM -- PM2 programmatic API quirks are documented but not deeply tested in this context

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (30 days -- stable domain, no fast-moving dependencies)
