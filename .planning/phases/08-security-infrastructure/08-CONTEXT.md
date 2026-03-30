# Phase 8: Security & Infrastructure - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** Auto-selected defaults (--auto mode)

<domain>
## Phase Boundary

API key authentication middleware on all endpoints (except health), nginx reverse proxy config with HTTPS/SSL, and PM2 process management for crash recovery and reboot persistence. Production-hardening layer.

</domain>

<decisions>
## Implementation Decisions

### API Key Authentication (SECR-01)
- **D-01:** Express middleware in `src/middleware/auth.ts` that checks `Authorization: Bearer <token>` header against `env.API_KEY`.
- **D-02:** `API_KEY` is already optional in env schema. Make it required when `NODE_ENV=production`. In development, skip auth if API_KEY is not set (log warning).
- **D-03:** Auth failure returns 401 with `{ error: { message: "Invalid or missing API key", code: "AUTH_FAILURE", retryable: false } }` using existing AppError + ERROR_CODES.
- **D-04:** Health endpoint (`GET /health`) is excluded from auth per Phase 7 decision D-04. It's already mounted before other routes in `src/routes/index.ts`.
- **D-05:** Auth middleware registered after health route but before all other routes in `src/app.ts`.

### Nginx Reverse Proxy (SECR-02)
- **D-06:** Nginx config template in `deploy/nginx/bluebubbles-api.conf` — shipped as a deliverable, not installed by code.
- **D-07:** Config: reverse proxy `localhost:PORT` → `https://domain`, SSL termination with Let's Encrypt/certbot, rate limiting at nginx level (backup to app-level).
- **D-08:** Headers: `X-Forwarded-For`, `X-Forwarded-Proto`, `Host`. Express trusts proxy (`app.set('trust proxy', 1)`).
- **D-09:** Direct access to Express port blocked by binding to `127.0.0.1` only (not `0.0.0.0`). Set in server.ts listen call.

### PM2 Process Management (SECR-03)
- **D-10:** Extend existing `ecosystem.config.js` with: `max_restarts: 10`, `restart_delay: 1000`, `autorestart: true`, `watch: false`.
- **D-11:** Add `deploy/pm2-startup.sh` script that runs `pm2 startup` + `pm2 save` for macOS reboot persistence.
- **D-12:** Add `npm run start:prod` script that runs `pm2 start ecosystem.config.js`.

### Claude's Discretion
- Exact nginx config details (worker_processes, buffer sizes, etc.)
- Whether to add CORS headers
- Whether to add helmet.js (already a dependency from Phase 2)
- Test strategy for auth middleware (unit test with mock req/res)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core vision, constraints
- `.planning/REQUIREMENTS.md` — SECR-01, SECR-02, SECR-03

### Existing Code
- `src/app.ts` — Express app factory (add auth middleware)
- `src/routes/index.ts` — Router (health already first)
- `src/config/env.ts` — API_KEY already in schema
- `src/types/error-codes.ts` — AUTH_FAILURE already defined
- `src/types/errors.ts` — AppError class
- `src/server.ts` — Listen call (bind to 127.0.0.1)
- `ecosystem.config.js` — PM2 config to extend
- `src/middleware/error-handler.ts` — Error handler

### Prior Phase Context
- `.planning/phases/07-health-monitoring/07-CONTEXT.md` — D-04: health no auth

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AppError` + `ERROR_CODES.AUTH_FAILURE` — Already defined
- `env.API_KEY` — Already optional in schema
- `ecosystem.config.js` — Already created in Phase 2
- `helmet` — Already installed as dependency

### Established Patterns
- Middleware pattern (logger, error-handler)
- Error response format: `{ error: { message, code, retryable } }`

### Integration Points
- `src/app.ts` — Register auth middleware
- `src/server.ts` — Bind to 127.0.0.1
- `ecosystem.config.js` — Add restart policies
- `package.json` — Add start:prod script

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard auth + nginx + PM2 patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-security-infrastructure*
*Context gathered: 2026-03-30 via --auto mode*
