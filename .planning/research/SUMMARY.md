# Project Research Summary

**Project:** BlueBubbles iMessage API Wrapper
**Domain:** iMessage API wrapper service for CRM integration
**Researched:** 2026-03-30
**Confidence:** HIGH

## Executive Summary

This project is a Node.js API wrapper that sits between Tyler's CRM and a BlueBubbles Server running on macOS. BlueBubbles is a community-maintained bridge to Apple's iMessage via the Messages.app on a Mac. The wrapper's job is to expose a clean, authenticated REST API for sending messages, retrieving conversations, and relaying inbound messages to Tyler's CRM via webhooks. The architecture is well-understood: Express handles HTTP, axios talks to BlueBubbles, and PM2 keeps the process alive. The stack is deliberately boring and maintainable because Tyler's team will own this long-term.

The recommended approach is a phased build starting with the Express scaffold and BlueBubbles client service, then layering on messaging endpoints, webhook relay with retry logic, and finally production hardening (nginx, SSL, PM2, deployment docs). Every config value is environment-driven so one codebase supports multiple phone numbers via separate PM2 processes. There is no database -- only a JSON file tracking the last successfully synced timestamp for message backfill after downtime.

The primary risks are: (1) BlueBubbles is community-maintained with no API stability guarantees -- pin to v1.9.9 and validate all responses with zod schemas to catch breaking changes early; (2) iMessage sessions can silently expire, requiring manual re-authentication on the Mac -- the health endpoint and downtime alerting are not nice-to-haves, they are critical; (3) BlueBubbles webhooks are fire-and-forget, so any downtime means lost messages unless the backfill-on-reconnect feature is implemented from day one. These three risks shaped the phase ordering below.

## Key Findings

### Recommended Stack

The stack prioritizes maintainability and zero unnecessary dependencies. Node.js 24 LTS with native TypeScript type-stripping eliminates the need for a build step. Express 5 (stable) provides async error handling out of the box. Node 24's native `--env-file` replaces dotenv entirely.

**Core technologies:**
- **Node.js 24 LTS + Express 5:** Runtime and HTTP framework -- async error handling, native TS support, widest community knowledge for handoff
- **axios:** HTTP client for BlueBubbles API -- interceptors for retry logic, error normalization, and credential redaction
- **zod 3.x:** Request and response validation -- TypeScript type inference from schemas, catches BB API shape changes
- **pino 9.x:** Structured JSON logging -- 5-10x faster than Winston, critical for 24/7 service on a single Mac
- **PM2 6.x:** Process management -- auto-restart, startup on boot, per-instance process isolation
- **nginx + certbot:** SSL termination and reverse proxy -- standard production pattern on macOS via Homebrew
- **helmet + express-rate-limit:** Security middleware -- HTTP headers and rate limiting with zero config

**What NOT to use:** No database (project requirement), no Docker (iMessage requires bare macOS), no Socket.io (webhooks are HTTP POST, not bidirectional), no Passport.js (single API key auth is a 10-line middleware).

### Expected Features

**Must have (table stakes):**
- Send iMessage by phone number (POST /send)
- Receive inbound messages via webhook relay to Tyler's CRM
- Conversation list and history with pagination
- Health endpoint that checks BlueBubbles status, not just Express uptime
- API key authentication (Bearer token)
- HTTPS/SSL via nginx
- Auto-restart on crash via PM2
- Structured, consistent error responses

**Should have (differentiators over raw BB access):**
- Webhook retry with exponential backoff (CRM might be temporarily down)
- Backfill on reconnect (catch up on missed messages using last_synced_at)
- Downtime alerting (POST to alert URL when BB or iMessage goes down)
- Multi-instance architecture (one instance per phone number, all config via env vars)
- Normalized response shapes (BB responses are inconsistent)

**Defer (v2+):**
- Group chat support
- MMS/media messages (investigate during build -- if BB returns attachment URLs for free, pass them through)
- Multi-tenant auth
- Frontend/dashboard
- Message queuing infrastructure (Redis/RabbitMQ)

### Architecture Approach

The architecture is a linear proxy chain: Tyler's CRM talks HTTPS to nginx, which proxies to our Express API on localhost, which talks HTTP to BlueBubbles Server on localhost. Inbound messages flow the reverse direction via webhooks. The key design principle is that our service is stateless except for a single `last_synced_at` JSON file. All BlueBubbles interaction is isolated behind a `BlueBubblesClient` service class -- no route handler touches BB directly.

**Major components:**
1. **Express API layer** -- auth, validation, routing, error handling, response normalization
2. **BlueBubbles Client service** -- axios wrapper with credential management, error translation, response normalization via zod
3. **Webhook Receiver** -- accepts POSTs from BlueBubbles, validates event shape, hands off to relay
4. **Webhook Relay** -- delivers transformed events to Tyler's CRM URL, manages in-memory retry queue with exponential backoff
5. **Health Monitor** -- periodic BB health checks via `/api/v1/server/info`, downtime detection, alert dispatch
6. **Sync State** -- async read/write of `last_synced_at` to JSON file, atomic writes via temp-file-then-rename
7. **Config module** -- zod-validated environment variables, fail-fast on startup if misconfigured

### Critical Pitfalls

1. **BlueBubbles API breaking changes** -- BB is community-maintained with no versioned API. Pin to v1.9.9, validate all responses with zod, test updates on a non-production instance first.
2. **iMessage silent sign-out** -- Apple periodically requires re-authentication. Health endpoint must check BB connection status and alert Tyler within 5 minutes of detected downtime.
3. **Lost messages during service downtime** -- BB webhooks are fire-and-forget. Backfill-on-reconnect using `last_synced_at` is not optional -- it is the mitigation for this.
4. **BB password leaking into logs** -- BB uses query param auth (`?password=xxx`). Axios interceptors must redact this from the first line of code. Use pino's redact option.
5. **Unbounded webhook retry queue** -- Cap at configurable max (e.g., 1000 events), drop oldest on overflow, rely on backfill to catch gaps after restart.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation
**Rationale:** Every subsequent phase depends on the Express app, auth middleware, config validation, and BlueBubbles client. Build the skeleton first.
**Delivers:** Running Express 5 app with health endpoint, Bearer token auth, zod config validation, structured error handling, pino logging, and a tested BlueBubbles client service with credential redaction.
**Addresses:** API key authentication, health endpoint (basic), structured error responses, config-as-schema pattern.
**Avoids:** BB password in logs (interceptor built from day one), Express 5 vs 4 confusion (v5 patterns established in scaffold), hardcoded instance values (env-driven from start).

### Phase 2: Core Messaging
**Rationale:** Send and retrieve are the primary value. They depend only on the BB client from Phase 1.
**Delivers:** POST /send, GET /conversations, GET /conversations/:id with pagination. Normalized response shapes via zod transforms.
**Addresses:** Send iMessage, conversation list, conversation history, normalized response shapes.
**Avoids:** Chat GUID format assumptions (use BB chat lookup where possible, handle iMessage vs SMS format).

### Phase 3: Webhook Pipeline
**Rationale:** Inbound message relay is the second half of the core value proposition. Depends on the BB client and a working Express app. The retry queue and backfill share the relay mechanism, so build them together.
**Delivers:** Inbound webhook receiver from BB, outbound webhook relay to Tyler's CRM, exponential backoff retry with capped queue, last_synced_at persistence, backfill-on-reconnect at startup.
**Addresses:** Receive inbound messages, webhook retry, backfill on reconnect, last_synced_at persistence.
**Avoids:** Unbounded retry queue (capped from day one), lost messages during downtime (backfill built in this phase), synchronous file I/O for sync state (async + atomic writes).

### Phase 4: Monitoring and Alerting
**Rationale:** Deep health checks and downtime alerting depend on the health endpoint from Phase 1 and the webhook relay from Phase 3 (alerts use the same HTTP POST mechanism).
**Delivers:** Deep health endpoint (BB server status, iMessage connection, memory usage), periodic health polling, configurable downtime alerting to Tyler's alert URL.
**Addresses:** Health endpoint depth, downtime alerting.
**Avoids:** Shallow health checks that only confirm Express is running (must check BB connection status).

### Phase 5: Production Hardening and Deployment
**Rationale:** Infrastructure concerns are last because they don't affect application logic. They require a working application to test against.
**Delivers:** Nginx reverse proxy config, SSL via certbot with launchd renewal, PM2 ecosystem config for multi-instance, macOS power management configuration, deployment documentation, API documentation.
**Addresses:** HTTPS/SSL, auto-restart on crash, multi-instance architecture.
**Avoids:** SSL cert renewal failure (launchd, not cron), PM2 cluster mode (instances: 1 per phone), macOS sleep (pmset configuration), PM2 startup not persisting after macOS update (documented procedure).

### Phase Ordering Rationale

- **Dependency chain:** Foundation -> Messaging -> Webhooks follows the natural dependency graph. You cannot build send/receive without the BB client, and you cannot build webhook relay without the Express app.
- **Value delivery:** Phases 1-3 deliver the complete send/receive loop. Tyler can start testing CRM integration after Phase 3.
- **Risk front-loading:** The backfill mechanism (Phase 3) addresses the most dangerous pitfall (lost messages) before production deployment.
- **Infrastructure last:** Nginx, SSL, and PM2 are operationally critical but architecturally independent. Building them last means the application logic is stable before layering on infrastructure.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Webhook Pipeline):** BlueBubbles webhook event format and reliability need hands-on testing. Documentation is sparse on edge cases (duplicate events, out-of-order delivery, event types beyond new-message). Recommend `/gsd:research-phase` before planning.
- **Phase 5 (Production Hardening):** EC2 Mac deployment specifics (if that is the target) need investigation -- instance types, pricing, iMessage setup on headless Mac, VNC access for re-authentication.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Express 5 scaffold, zod config, pino logging, Bearer auth are all well-documented patterns.
- **Phase 2 (Core Messaging):** REST endpoint patterns are standard. BB API is documented with a Postman collection.
- **Phase 4 (Monitoring):** Health check and alerting patterns are straightforward HTTP polling and POST.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies are mainstream, well-documented, and version-verified. Node 24 LTS, Express 5 stable, all npm packages confirmed current. |
| Features | HIGH | Feature set is well-scoped. BlueBubbles API capabilities verified against official docs and Postman collection. Clear table stakes vs differentiators. |
| Architecture | HIGH | Linear proxy architecture is a standard pattern. Component boundaries are clean. Scalability path (more Macs for more phones) is clear. |
| Pitfalls | HIGH | Pitfalls sourced from BlueBubbles community issues, macOS operational experience, and Express migration docs. Phase-specific warnings are actionable. |

**Overall confidence:** HIGH

### Gaps to Address

- **BlueBubbles webhook event format:** Documentation covers the basics but edge cases (duplicate events, reconnection behavior, all event types) need hands-on testing during Phase 3 implementation.
- **MMS/attachment handling:** Explicitly deferred, but worth a quick investigation during Phase 2 -- if BB returns attachment URLs for free, passing them through adds value at near-zero cost.
- **EC2 Mac deployment specifics:** If Tyler's deployment target is AWS EC2 Mac, Phase 5 needs research into instance availability, pricing (dedicated hosts), and headless iMessage setup.
- **Apple rate limiting:** Unknown whether Apple throttles iMessage sending at high volumes. Not a concern for POC but could matter if Tyler scales to many messages per day.
- **BlueBubbles Private API:** Not needed for POC scope (standard text send/receive works without it), but some advanced features (read receipts, typing indicators) require SIP disabled. Document as a future option.

## Sources

### Primary (HIGH confidence)
- [Node.js Releases](https://nodejs.org/en/about/previous-releases) -- Node 24 LTS status
- [Express.js](https://expressjs.com/) -- v5 stable, migration guide
- [BlueBubbles REST API Docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) -- API endpoints, webhooks
- [BlueBubbles Postman Collection](https://documenter.getpostman.com/view/765844/UV5RnfwM) -- API request/response examples
- [BlueBubbles Server Releases](https://github.com/BlueBubblesApp/bluebubbles-server/releases) -- v1.9.9 confirmed

### Secondary (MEDIUM confidence)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/) -- ecosystem config, startup
- [Certbot macOS](https://certbot.eff.org/instructions?ws=other&os=osx) -- SSL setup, launchd renewal
- [Pino vs Winston benchmarks](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/) -- performance comparison
- [BlueBubbles FAQ](https://bluebubbles.app/faq/) -- known issues and limitations

### Tertiary (LOW confidence)
- Apple iMessage rate limiting -- no official documentation found, inferred from community reports
- EC2 Mac deployment patterns -- limited public documentation for iMessage-specific use cases

---
*Research completed: 2026-03-30*
*Ready for roadmap: yes*
