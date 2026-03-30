# Phase 7: Health & Monitoring - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** Auto-selected defaults (--auto mode)

<domain>
## Phase Boundary

GET /health endpoint that reports live status of BlueBubbles, iPhone connection, and iMessage auth. Periodic health polling to detect silent failures. Downtime alerting that POSTs to a configurable alert URL when service goes down.

</domain>

<decisions>
## Implementation Decisions

### Health Endpoint Response
- **D-01:** GET /health returns JSON: `{ status: "healthy"|"degraded"|"down", bluebubbles: { status: string, version: string }, imessage: { authenticated: boolean }, system: { macosVersion: string }, timestamp: string }`.
- **D-02:** "healthy" = BB reachable + iMessage authenticated. "degraded" = BB reachable but iMessage not authenticated. "down" = BB unreachable.
- **D-03:** BB version and macOS version obtained from BB's server info API endpoint (HLTH-02).
- **D-04:** Health endpoint does NOT require auth — it's a status page. (Phase 8 adds API key auth to other endpoints.)

### Periodic Health Polling
- **D-05:** Poll BB health every 60 seconds (configurable via `HEALTH_POLL_INTERVAL_MS` env var, default 60000).
- **D-06:** Use setInterval with `.unref()` for graceful shutdown, consistent with dedup and retry patterns.
- **D-07:** Track consecutive failure count. Reset to 0 on successful check.

### Downtime Alerting
- **D-08:** Alert fires after `ALERT_AFTER_FAILURES` consecutive failed health checks (default 2, configurable via env).
- **D-09:** POST to `ALERT_WEBHOOK_URL` (already optional in env schema) with payload: `{ type: "downtime_alert", service: "bluebubbles"|"imessage", status: string, message: string, timestamp: string }`.
- **D-10:** If `ALERT_WEBHOOK_URL` is not configured, log warning and skip alerting (same pattern as CRM webhook).
- **D-11:** Don't re-alert on every poll — alert once when threshold is crossed, then again only after recovery + re-failure.

### Architecture
- **D-12:** Health check logic in `src/services/health.ts` — queries BB API, returns structured health status.
- **D-13:** Health polling + alerting in `src/services/health-monitor.ts` — runs the periodic check and fires alerts.
- **D-14:** Route in `src/routes/health.ts` — thin GET /health handler calling health service.
- **D-15:** Initialize health monitor in `src/server.ts` after other services.

### Claude's Discretion
- Exact BB API endpoint for server info/health (researcher will verify)
- How to obtain macOS version (node:os or BB API)
- Whether to add a `lastChecked` field to health response
- Test mocking strategy for health checks

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core vision, constraints
- `.planning/REQUIREMENTS.md` — HLTH-01, HLTH-02, HLTH-03, HLTH-04
- `.planning/research/SUMMARY.md` — BB API behavior

### Existing Code
- `src/services/bluebubbles.ts` — BB client with request method
- `src/types/error-codes.ts` — Error codes
- `src/config/env.ts` — Env schema (ALERT_WEBHOOK_URL already present)
- `src/routes/index.ts` — Router to extend
- `src/server.ts` — Entry point for monitor init
- `src/services/dedup.ts` — `.unref()` pattern to follow

### Prior Phase Context
- `.planning/phases/05-inbound-webhook-pipeline/05-CONTEXT.md` — Webhook relay pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BlueBubblesClient.request<T>()` — Query BB health/info API
- `AppError` + `ERROR_CODES` — Error handling
- `env.ALERT_WEBHOOK_URL` — Already optional in schema
- Native `fetch` for alert POST (same as webhook relay)
- Pino logger with credential redaction

### Established Patterns
- `.unref()` on intervals (dedup, retry)
- Singleton services with init/shutdown
- Thin routes calling services

### Integration Points
- `src/routes/index.ts` — Mount health route
- `src/server.ts` — Initialize health monitor
- `src/config/env.ts` — Add HEALTH_POLL_INTERVAL_MS, ALERT_AFTER_FAILURES

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard health check + alerting pattern.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-health-monitoring*
*Context gathered: 2026-03-30 via --auto mode*
