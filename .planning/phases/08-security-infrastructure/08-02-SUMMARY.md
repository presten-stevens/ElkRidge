---
phase: 08-security-infrastructure
plan: 02
subsystem: infra
tags: [nginx, pm2, express, ssl, reverse-proxy, loopback]

requires:
  - phase: 08-security-infrastructure/01
    provides: auth middleware, trust proxy, helmet headers
provides:
  - Express loopback-only binding (127.0.0.1)
  - PM2 crash recovery config (max_restarts, restart_delay)
  - PM2 macOS launchd persistence script
  - nginx HTTPS reverse proxy template with SSL
  - start:prod npm script for PM2 production deployment
affects: [09-deployment-documentation]

tech-stack:
  added: [pm2, nginx]
  patterns: [loopback-only binding, nginx reverse proxy with rate limiting]

key-files:
  created:
    - deploy/pm2-startup.sh
    - deploy/nginx/bluebubbles-api.conf
  modified:
    - src/server.ts
    - ecosystem.config.js
    - package.json

key-decisions:
  - "Express binds 127.0.0.1 only -- not externally accessible, nginx handles public traffic"
  - "PM2 max_restarts: 10 with 1s delay -- bounded crash recovery prevents infinite restart loops"
  - "nginx rate limit 10r/s with burst=20 -- defense-in-depth backup to app-level rate limiting"
  - "Health endpoint bypasses nginx rate limiting -- monitoring must not be throttled"

patterns-established:
  - "Loopback binding: Express never exposes port externally, only via reverse proxy"
  - "Deploy templates: config files use __PLACEHOLDER__ convention for env-specific values"

requirements-completed: [SECR-02, SECR-03]

duration: 2min
completed: 2026-03-31
---

# Phase 8 Plan 2: Network Hardening and Process Management Summary

**Express loopback-only binding, PM2 crash recovery with launchd persistence, and nginx HTTPS reverse proxy template with SSL/rate-limiting**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-31T03:27:37Z
- **Completed:** 2026-03-31T03:29:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Express bound to 127.0.0.1 only -- direct port access blocked, all traffic must route through nginx
- PM2 config hardened with max_restarts: 10, restart_delay: 1000ms, watch: false for production stability
- nginx config template with HTTPS/SSL, rate limiting (10r/s burst 20), proxy headers, and health bypass
- PM2 startup script for macOS launchd reboot persistence
- start:prod npm script for production deployment via PM2

## Task Commits

Each task was committed atomically:

1. **Task 1: Bind Express to 127.0.0.1 and extend PM2 config** - `f7ef541` (feat)
2. **Task 2: Create nginx reverse proxy config template** - `aaa298d` (feat)

## Files Created/Modified
- `src/server.ts` - Added 127.0.0.1 loopback binding to app.listen()
- `ecosystem.config.js` - Added max_restarts, restart_delay, watch fields
- `package.json` - Added start:prod script for PM2
- `deploy/pm2-startup.sh` - PM2 launchd startup script for macOS reboot persistence
- `deploy/nginx/bluebubbles-api.conf` - nginx reverse proxy template with HTTPS, SSL, rate limiting

## Decisions Made
- Express binds 127.0.0.1 only -- nginx is the only public-facing entry point
- PM2 bounded restarts (10 max, 1s delay) prevents infinite crash loops while allowing recovery
- nginx rate limiting (10r/s burst 20) provides defense-in-depth backup to app-level TokenBucket
- Health endpoint excluded from rate limiting so monitoring is never throttled
- Config template uses __DOMAIN__ and __PORT__ placeholders for multi-instance flexibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None - all artifacts are complete and functional.

## User Setup Required

None - no external service configuration required. The nginx config and PM2 startup script are deployment templates to be used during AWS EC2 setup (Phase 9).

## Next Phase Readiness
- Network hardening complete: Express loopback + nginx proxy + PM2 crash recovery
- Ready for deployment documentation phase (Phase 9)
- nginx template ready for certbot SSL setup on production server

---
*Phase: 08-security-infrastructure*
*Completed: 2026-03-31*
