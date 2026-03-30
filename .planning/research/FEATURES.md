# Feature Landscape

**Domain:** iMessage API wrapper service
**Researched:** 2026-03-30

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Send iMessage by phone number | Core value proposition — Tyler's CRM needs to send messages | Low | BlueBubbles `/api/v1/message/text` does the heavy lifting |
| Receive inbound messages via webhook | CRM must know when messages arrive without polling | Medium | BlueBubbles webhooks -> our relay -> Tyler's URL. Retry logic is the complexity. |
| Conversation list | Tyler needs to see all threads | Low | Direct passthrough from BlueBubbles `/api/v1/chat` |
| Conversation history with pagination | View full thread history | Low | BlueBubbles `/api/v1/chat/:guid/message` with offset/limit |
| Health endpoint | Know when iMessage bridge is down | Medium | Must check BlueBubbles status, iPhone connection, iMessage auth — not just "is Express running" |
| API key authentication | Security baseline for any production API | Low | Bearer token middleware, single key per instance |
| HTTPS/SSL | Non-negotiable for production API carrying message content | Low | Nginx + certbot handles this |
| Auto-restart on crash | 24/7 service must survive failures | Low | PM2 handles this |
| Structured error responses | Tyler's CRM needs machine-parseable errors | Low | Consistent `{ error: { code, message, details } }` shape |

## Differentiators

Features that set this apart from raw BlueBubbles API access.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Webhook retry with exponential backoff | Tyler's CRM might be temporarily down — messages must not be lost | Medium | Queue retries in memory, cap at configurable max attempts |
| Backfill on reconnect | If service was down, catch up on missed messages | Medium | Query BB for messages since `last_synced_at`, relay to webhook |
| Downtime alerting | Tyler knows within minutes if something breaks | Medium | Periodic health check, POST to configurable alert URL if threshold exceeded |
| Multi-instance architecture | One instance per phone number, no hardcoded values | Low | All config via env vars, PM2 ecosystem file |
| Clean REST API abstraction | Hide BlueBubbles auth mechanism (query param `password`) behind standard Bearer token | Low | Better DX for Tyler's team |
| Normalized response shapes | BlueBubbles responses are inconsistent — normalize to predictable shapes | Medium | Zod schemas for BB responses, transform to our output format |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Database/persistence layer | Tyler handles all persistence. Adding DB creates ops burden we don't own. | JSON file for `last_synced_at` only |
| Group chat support | Out of scope for POC, adds complexity in threading model | Return clear error if group chat detected |
| MMS/media messages | Out of scope unless BlueBubbles handles trivially | Investigate during build — if BB returns attachment URLs for free, pass them through |
| Frontend/dashboard | API only. Tyler's CRM is the UI. | API docs serve as the interface documentation |
| Multi-tenant auth | Single API key per instance is sufficient for POC | If Tyler needs multi-tenant later, that's a separate phase |
| Message queuing (Redis/RabbitMQ) | Over-engineering. In-memory retry queue is sufficient for single-instance. | In-memory array with backoff timer |
| AI/ML features | Explicitly out of scope | Not part of this engagement |

## Feature Dependencies

```
BlueBubbles Server running -> All features
API key auth -> All endpoints
Health endpoint -> Downtime alerting (alerting checks health)
Webhook receiver (from BB) -> Webhook relay (to Tyler) -> Webhook retry
Webhook relay -> Backfill on reconnect (same relay mechanism)
last_synced_at persistence -> Backfill on reconnect
Nginx + SSL -> Production deployment
PM2 -> Auto-restart, startup on boot
```

## MVP Recommendation

**Phase 1 — Foundation (build first):**
1. Express app scaffold with auth middleware, error handling, health endpoint
2. BlueBubbles API client service (axios wrapper with error normalization)

**Phase 2 — Core messaging:**
3. POST /send endpoint
4. GET /conversations and GET /conversations/:id

**Phase 3 — Real-time:**
5. Inbound webhook receiver (from BlueBubbles)
6. Outbound webhook relay (to Tyler's CRM)
7. Webhook retry with exponential backoff

**Phase 4 — Reliability:**
8. Backfill on reconnect (last_synced_at)
9. Downtime alerting
10. Health endpoint depth (BB status, iPhone connection)

**Phase 5 — Production hardening:**
11. Nginx + SSL
12. PM2 configuration
13. Multi-instance validation
14. API documentation
15. AWS EC2 Mac deployment guide

**Defer:** Group chat, MMS, multi-tenant auth, database

## Sources

- [BlueBubbles REST API](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks)
- [BlueBubbles Postman Collection](https://documenter.getpostman.com/view/765844/UV5RnfwM)
