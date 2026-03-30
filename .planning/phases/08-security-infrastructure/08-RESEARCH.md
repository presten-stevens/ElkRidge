# Phase 08: Security & Infrastructure - Research

**Researched:** 2026-03-30
**Domain:** Express authentication middleware, nginx reverse proxy, PM2 process management
**Confidence:** HIGH

## Summary

This phase adds three production-hardening layers to an already-functioning Express 5 API: Bearer token authentication middleware, an nginx reverse proxy config with HTTPS/SSL termination, and PM2 crash recovery with reboot persistence. All three are well-understood, stable patterns with no novel technical risk.

The codebase already has the key building blocks in place: `API_KEY` is defined (optional) in the env schema, `AUTH_FAILURE` exists as an error code (needs to be added -- see note below), `AppError` handles structured error responses, `helmet` is installed, and `ecosystem.config.js` has a working PM2 config. The work is primarily wiring: a new middleware file, env schema adjustment, `app.ts` registration order, `server.ts` bind address change, PM2 config extension, and a deliverable nginx config template.

**Primary recommendation:** Implement auth middleware first (most code), then server.ts bind change + PM2 config (quick), then nginx config template (deliverable file, no runtime code).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Express middleware in `src/middleware/auth.ts` that checks `Authorization: Bearer <token>` header against `env.API_KEY`.
- **D-02:** `API_KEY` is already optional in env schema. Make it required when `NODE_ENV=production`. In development, skip auth if API_KEY is not set (log warning).
- **D-03:** Auth failure returns 401 with `{ error: { message: "Invalid or missing API key", code: "AUTH_FAILURE", retryable: false } }` using existing AppError + ERROR_CODES.
- **D-04:** Health endpoint (`GET /health`) is excluded from auth per Phase 7 decision D-04. It's already mounted before other routes in `src/routes/index.ts`.
- **D-05:** Auth middleware registered after health route but before all other routes in `src/app.ts`.
- **D-06:** Nginx config template in `deploy/nginx/bluebubbles-api.conf` -- shipped as a deliverable, not installed by code.
- **D-07:** Config: reverse proxy `localhost:PORT` -> `https://domain`, SSL termination with Let's Encrypt/certbot, rate limiting at nginx level (backup to app-level).
- **D-08:** Headers: `X-Forwarded-For`, `X-Forwarded-Proto`, `Host`. Express trusts proxy (`app.set('trust proxy', 1)`).
- **D-09:** Direct access to Express port blocked by binding to `127.0.0.1` only (not `0.0.0.0`). Set in server.ts listen call.
- **D-10:** Extend existing `ecosystem.config.js` with: `max_restarts: 10`, `restart_delay: 1000`, `autorestart: true`, `watch: false`.
- **D-11:** Add `deploy/pm2-startup.sh` script that runs `pm2 startup` + `pm2 save` for macOS reboot persistence.
- **D-12:** Add `npm run start:prod` script that runs `pm2 start ecosystem.config.js`.

### Claude's Discretion
- Exact nginx config details (worker_processes, buffer sizes, etc.)
- Whether to add CORS headers
- Whether to add helmet.js (already a dependency from Phase 2)
- Test strategy for auth middleware (unit test with mock req/res)

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SECR-01 | API key authentication via Authorization: Bearer header on all endpoints | Auth middleware pattern (D-01 through D-05), AUTH_FAILURE error code, AppError class, env schema conditional requirement |
| SECR-02 | Nginx reverse proxy configured with HTTPS/SSL termination | Nginx config template (D-06 through D-09), trust proxy setting, 127.0.0.1 bind |
| SECR-03 | PM2 process management for uptime across reboots | PM2 ecosystem config extension (D-10 through D-12), startup script, npm script |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.2.1 | Web framework (already installed) | Project standard |
| helmet | ^8.1.0 | Security headers (already installed) | Already in use since Phase 2 |
| zod | ^4.3.6 | Schema validation (already installed) | Used for env validation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pm2 | latest (global install) | Process manager | Production deployment -- installed globally, not as dependency |
| nginx | OS package | Reverse proxy + SSL | Deployed on target machine, config template provided |
| certbot | OS package | Let's Encrypt SSL certificates | Used with nginx for HTTPS |

### No New Dependencies
This phase requires zero new npm dependencies. Everything needed is already in `package.json` or is infrastructure tooling installed at the OS level.

## Architecture Patterns

### Recommended Project Structure
```
src/
  middleware/
    auth.ts              # NEW: Bearer token auth middleware
    error-handler.ts     # Existing
    logger.ts            # Existing
  routes/
    index.ts             # MODIFY: route registration order for auth
  config/
    env.ts               # MODIFY: API_KEY conditional requirement
  types/
    error-codes.ts       # MODIFY: add AUTH_FAILURE code
  app.ts                 # MODIFY: register auth middleware, trust proxy
  server.ts              # MODIFY: bind to 127.0.0.1
deploy/
  nginx/
    bluebubbles-api.conf # NEW: nginx config template
  pm2-startup.sh         # NEW: PM2 reboot persistence script
ecosystem.config.js      # MODIFY: add restart policies
package.json             # MODIFY: add start:prod script
```

### Pattern 1: Auth Middleware with Conditional Enforcement
**What:** Middleware that checks Bearer token against env, with development bypass.
**When to use:** Every request except health endpoint.
**Example:**
```typescript
// src/middleware/auth.ts
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';
import { logger } from './logger.js';

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // Development bypass: skip auth if API_KEY not configured
  if (!env.API_KEY) {
    logger.warn('API_KEY not set -- authentication disabled');
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(
      'Invalid or missing API key',
      ERROR_CODES.AUTH_FAILURE,
      false,
      401,
    );
  }

  const token = authHeader.slice(7); // 'Bearer '.length
  if (token !== env.API_KEY) {
    throw new AppError(
      'Invalid or missing API key',
      ERROR_CODES.AUTH_FAILURE,
      false,
      401,
    );
  }

  next();
}
```

### Pattern 2: Route Registration Order for Selective Auth
**What:** Health route mounted before auth middleware so it bypasses authentication.
**When to use:** `src/app.ts` middleware chain.
**Example:**
```typescript
// src/app.ts -- modified
import { healthRouter } from './routes/health.js';
import { authMiddleware } from './middleware/auth.js';
import { protectedRouter } from './routes/index.js'; // routes needing auth

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // D-08: trust nginx proxy headers

  app.use(helmet());
  app.use(express.json());
  app.use(httpLogger);

  // Health BEFORE auth (D-04, D-05)
  app.use(healthRouter);

  // Auth middleware gates all subsequent routes
  app.use(authMiddleware);

  // Protected routes
  app.use(protectedRouter);

  app.use(errorHandler);
  return app;
}
```

**Key insight:** This requires restructuring `src/routes/index.ts`. Currently it exports a single `router` that includes healthRouter. The health route needs to be extracted and mounted directly in `app.ts` before the auth middleware, while the remaining routes (send, conversations) go through auth.

### Pattern 3: Conditional Env Validation with Zod
**What:** API_KEY required in production, optional in development.
**When to use:** `src/config/env.ts` schema.
**Example:**
```typescript
// Option: use superRefine for conditional requirement
const envSchema = z.object({
  // ... existing fields
  API_KEY: z.string().min(16).optional(),
  // ... existing fields
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && !data.API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'API_KEY is required in production',
      path: ['API_KEY'],
    });
  }
});
```

### Pattern 4: 127.0.0.1 Binding
**What:** Bind Express to loopback only so direct access is blocked.
**When to use:** `src/server.ts` listen call.
**Example:**
```typescript
// Before: app.listen(env.PORT, () => { ... })
// After:
app.listen(env.PORT, '127.0.0.1', () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
  // ... existing init code
});
```

### Anti-Patterns to Avoid
- **Timing-attack vulnerable comparison:** Do NOT use `===` for token comparison in production security. However, for a single-API-key POC where the key is a pre-shared secret (not hashed), direct comparison is acceptable and what the CONTEXT.md specifies. If upgrading later, use `crypto.timingSafeEqual`.
- **Auth middleware that catches its own errors:** Let AppError propagate to the existing error handler. Do not try/catch inside the middleware.
- **Hardcoded 127.0.0.1 without documentation:** Make clear in the deployment guide that nginx must be on the same machine.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Security headers | Custom header middleware | helmet (already installed) | Covers 11+ header types, maintained |
| SSL certificates | Self-signed cert management | certbot + Let's Encrypt | Free, auto-renewable, trusted |
| Process management | Custom watchdog/respawn script | PM2 | Battle-tested, macOS launchd integration |
| Rate limiting at proxy | Express-only rate limiting | nginx `limit_req_zone` | Drops requests before they hit Node |

**Key insight:** This phase is mostly configuration and wiring, not custom code. The only meaningful new code is the auth middleware (~30 lines).

## Common Pitfalls

### Pitfall 1: Health Route Still Behind Auth After Refactor
**What goes wrong:** Health monitoring breaks because the route registration order changes and health ends up behind the auth middleware.
**Why it happens:** Currently `src/routes/index.ts` bundles ALL routes including health. Refactoring for auth placement can accidentally gate health.
**How to avoid:** Extract healthRouter mount to app.ts directly, BEFORE authMiddleware. Verify with a test that `GET /health` returns 200 without Authorization header.
**Warning signs:** Health monitoring alerts fire, uptime checks fail.

### Pitfall 2: Zod superRefine Breaks Existing Tests
**What goes wrong:** Adding `.superRefine()` to envSchema changes the validation behavior, and existing tests that import `envSchema` directly may fail.
**Why it happens:** superRefine runs after all field parsing, and tests may not set NODE_ENV.
**How to avoid:** Default NODE_ENV is 'development', so tests without API_KEY should still pass. Verify existing env.test.ts still passes after the change.
**Warning signs:** Test failures in env validation tests.

### Pitfall 3: PM2 ecosystem.config.js ES Module Format
**What goes wrong:** PM2 may not handle ES module syntax (`export default`) correctly.
**Why it happens:** The project uses `"type": "module"` in package.json, and the current `ecosystem.config.js` uses `export default`. PM2 versions before 5.3.0 had issues with ESM config files.
**How to avoid:** Keep the current `export default` syntax which is already working. If PM2 has issues, rename to `ecosystem.config.cjs` and use `module.exports`.
**Warning signs:** `pm2 start ecosystem.config.js` fails with "Cannot use import statement" or similar.

### Pitfall 4: Express 5 Async Error Handling
**What goes wrong:** Auth middleware throws an AppError but Express 5 may not catch synchronous throws from middleware.
**Why it happens:** Express 5 automatically catches rejected promises from async handlers, but for synchronous middleware that throws, the behavior may vary.
**How to avoid:** The existing error-handler.test.ts confirms synchronous throws work through the error handler. The auth middleware is synchronous, and Express 5 does handle synchronous throws in middleware. Still, wrapping in try/catch or using `next(error)` is safer.
**Warning signs:** Unhandled exception crashes instead of 401 response.

**Recommendation:** Use `next(new AppError(...))` instead of `throw new AppError(...)` for maximum compatibility. This is the Express-idiomatic pattern.

### Pitfall 5: nginx Config Not Matching App Port
**What goes wrong:** The nginx template hardcodes a port that doesn't match the actual PORT env var.
**Why it happens:** Config template uses a placeholder but deployer doesn't update it.
**How to avoid:** Use clearly marked placeholders like `__PORT__` or comments in the nginx config. Document the required substitution.
**Warning signs:** 502 Bad Gateway from nginx.

## Code Examples

### Auth Middleware with next() Pattern
```typescript
// src/middleware/auth.ts
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';
import { logger } from './logger.js';

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!env.API_KEY) {
    logger.warn('API_KEY not set -- authentication disabled');
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next(new AppError('Invalid or missing API key', ERROR_CODES.AUTH_FAILURE, false, 401));
    return;
  }

  const token = authHeader.slice(7);
  if (token !== env.API_KEY) {
    next(new AppError('Invalid or missing API key', ERROR_CODES.AUTH_FAILURE, false, 401));
    return;
  }

  next();
}
```

### AUTH_FAILURE Error Code Addition
```typescript
// src/types/error-codes.ts -- add AUTH_FAILURE
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_PHONE: 'INVALID_PHONE',
  RATE_LIMITED: 'RATE_LIMITED',
  BB_OFFLINE: 'BB_OFFLINE',
  BB_IMESSAGE_DISCONNECTED: 'BB_IMESSAGE_DISCONNECTED',
  SEND_FAILED: 'SEND_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  WEBHOOK_DELIVERY_FAILED: 'WEBHOOK_DELIVERY_FAILED',
  AUTH_FAILURE: 'AUTH_FAILURE',  // NEW
} as const;
```

### Nginx Config Template
```nginx
# deploy/nginx/bluebubbles-api.conf
# BlueBubbles iMessage API - Nginx Reverse Proxy
#
# Installation:
#   1. Copy to /etc/nginx/sites-available/bluebubbles-api.conf
#   2. Replace __DOMAIN__ with your domain name
#   3. Replace __PORT__ with your Express port (default: 3000)
#   4. Run: sudo ln -s /etc/nginx/sites-available/bluebubbles-api.conf /etc/nginx/sites-enabled/
#   5. Run: sudo certbot --nginx -d __DOMAIN__
#   6. Run: sudo nginx -t && sudo systemctl reload nginx

# Rate limiting zone (backup to app-level rate limiting)
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    listen 80;
    server_name __DOMAIN__;

    # Redirect HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name __DOMAIN__;

    # SSL managed by certbot (paths added automatically)
    # ssl_certificate /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;

    # Security headers (supplement helmet)
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;

    location / {
        limit_req zone=api burst=20 nodelay;

        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;

        # Required headers (D-08)
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;

        # Timeouts
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }

    # Health check bypass (no rate limit on health)
    location = /health {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### PM2 Startup Script
```bash
#!/usr/bin/env bash
# deploy/pm2-startup.sh
# Configures PM2 to survive macOS reboots
#
# Usage: bash deploy/pm2-startup.sh

set -euo pipefail

echo "Configuring PM2 startup for macOS..."

# Generate and install launchd plist
pm2 startup launchd

# Save current process list
pm2 save

echo "PM2 startup configured. Service will survive reboots."
```

### Extended ecosystem.config.js
```javascript
export default {
  apps: [
    {
      name: 'bb-tyler-iphone',
      script: 'dist/server.js',
      env_file: '.env.tyler_iphone',
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      max_restarts: 10,       // D-10
      restart_delay: 1000,     // D-10
      watch: false,            // D-10
    },
  ],
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express 4 async error handling workarounds | Express 5 native async catch | Express 5 (2024) | Async middleware errors auto-caught |
| `app.listen(port)` binds 0.0.0.0 | `app.listen(port, '127.0.0.1')` for security | Always available | Blocks direct external access |
| PM2 with CommonJS config | PM2 supports ESM ecosystem.config.js | PM2 5.3+ | Use `export default` syntax |

## Discretion Recommendations

### CORS Headers
**Recommendation: Add basic CORS configuration.**
Tyler's CRM will call this API from a server, not a browser, so CORS is not strictly required. However, if any browser-based testing or admin UI is ever added, missing CORS will be confusing. Add a minimal CORS setup:
```typescript
// In app.ts, after helmet
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});
```
Or skip it entirely since this is server-to-server. **Lean toward skipping** -- less attack surface, and Tyler can request it if needed.

### Helmet Configuration
**Recommendation: Keep helmet with defaults.** Already installed and configured in `app.ts`. No changes needed -- the defaults are appropriate for an API server.

### Test Strategy for Auth Middleware
**Recommendation: Unit tests with mock req/res, matching existing error-handler.test.ts pattern.**
Test cases:
1. Request with valid Bearer token passes through (next called, no error)
2. Request with no Authorization header returns 401 AUTH_FAILURE
3. Request with wrong token returns 401 AUTH_FAILURE
4. Request with malformed header (no "Bearer " prefix) returns 401
5. When API_KEY not set (dev mode), request passes without auth
6. Health endpoint returns 200 without auth header (integration-level, via supertest)

## Open Questions

1. **PM2 ESM Compatibility**
   - What we know: Current ecosystem.config.js uses `export default` and the project has `"type": "module"`. PM2 5.3+ supports this.
   - What's unclear: The exact PM2 version that will be installed globally on the deployment target.
   - Recommendation: Keep `export default` syntax. If PM2 errors on deployment, rename to `.cjs` and switch to `module.exports` as fallback. Document both options.

2. **nginx on macOS vs Linux**
   - What we know: Dev machine is macOS (Darwin 25.2.0). Production target is AWS EC2 Mac (also macOS).
   - What's unclear: Whether macOS nginx uses `sites-available/sites-enabled` pattern or just `nginx.conf` includes.
   - Recommendation: The nginx config template should document both patterns. On macOS with Homebrew nginx, configs go in `/opt/homebrew/etc/nginx/servers/`. On Linux, `/etc/nginx/sites-available/`. Document both in the config header comments.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.3.0 | -- |
| npm | Package management | Yes | 11.4.2 | -- |
| nginx | SECR-02 reverse proxy | No | -- | Config is a deliverable template; not needed at dev time |
| PM2 | SECR-03 process management | No | -- | `npm install -g pm2` when ready to test; not needed for code changes |
| certbot | SECR-02 SSL certificates | No | -- | Only needed on deployment target |

**Missing dependencies with no fallback:**
- None blocking development. nginx/PM2/certbot are deployment-time dependencies.

**Missing dependencies with fallback:**
- PM2 can be installed globally (`npm install -g pm2`) for local testing of ecosystem.config.js, but is not required for the code changes in this phase.

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
| SECR-01a | Valid Bearer token passes auth | unit | `npx vitest run src/middleware/__tests__/auth.test.ts -t "valid token"` | No -- Wave 0 |
| SECR-01b | Missing/invalid token returns 401 | unit | `npx vitest run src/middleware/__tests__/auth.test.ts -t "missing"` | No -- Wave 0 |
| SECR-01c | Dev mode skips auth when no API_KEY | unit | `npx vitest run src/middleware/__tests__/auth.test.ts -t "no API_KEY"` | No -- Wave 0 |
| SECR-01d | Health endpoint accessible without auth | unit | `npx vitest run src/middleware/__tests__/auth.test.ts -t "health"` | No -- Wave 0 |
| SECR-02 | nginx config is valid template | manual | Visual inspection of `deploy/nginx/bluebubbles-api.conf` | N/A |
| SECR-03 | PM2 config has restart policies | manual | Inspect `ecosystem.config.js` for max_restarts, restart_delay | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/middleware/__tests__/auth.test.ts` -- covers SECR-01 (auth middleware unit tests)

## Sources

### Primary (HIGH confidence)
- Express 5 documentation -- middleware registration order, trust proxy setting, async error handling
- Project codebase -- direct reading of app.ts, server.ts, env.ts, error-codes.ts, routes/index.ts, ecosystem.config.js
- CONTEXT.md decisions D-01 through D-12 -- locked implementation choices

### Secondary (MEDIUM confidence)
- PM2 ecosystem file documentation -- ESM support, restart policies, startup command
- nginx reverse proxy configuration -- standard patterns for Node.js backend proxying

### Tertiary (LOW confidence)
- PM2 ESM compatibility edge cases (may vary by PM2 version installed)
- macOS nginx config file locations (Homebrew vs system)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries
- Architecture: HIGH -- straightforward middleware + config changes, patterns well-established
- Pitfalls: HIGH -- common Express/nginx/PM2 issues are well-documented

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable domain, no fast-moving dependencies)
