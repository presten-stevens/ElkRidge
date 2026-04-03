# Roadmap: BlueBubbles iMessage API

## Overview

This roadmap delivers a production-ready iMessage REST API wrapper for Tyler at Elk Ridge Investments. It starts with manual BlueBubbles verification (no code until the hardware bridge works), scaffolds a config-driven Express 5 application, builds out the complete send/receive messaging loop across four phases, adds health monitoring and downtime alerting, hardens with nginx/SSL/PM2, and closes with documentation and ownership transfer. The phase ordering front-loads risk: BlueBubbles verification first (the entire project depends on it), backfill and retry logic before production deployment (lost messages are the biggest operational risk), and infrastructure last (it wraps working application logic).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: BlueBubbles Setup & Verification** - Install and verify BlueBubbles sends/receives iMessages before writing any code
- [ ] **Phase 2: Project Scaffold & Configuration** - Express 5 app skeleton with env-driven config, structured logging, and credential safety
- [ ] **Phase 3: Send Messaging** - POST /send endpoint with error handling, queued status, and rate limiting
- [ ] **Phase 4: Read Messaging** - Conversation list and message history endpoints with pagination
- [ ] **Phase 5: Inbound Webhook Pipeline** - Receive BlueBubbles events and relay to Tyler's CRM with dedup and delivery tracking
- [ ] **Phase 6: Webhook Reliability & Backfill** - Retry failed webhook deliveries and backfill missed messages after downtime
- [x] **Phase 7: Health & Monitoring** - Deep health checks and proactive downtime alerting (completed 2026-03-30)
- [x] **Phase 8: Security & Infrastructure** - API key auth, nginx reverse proxy, SSL, and PM2 process management (completed 2026-03-31)
- [ ] **Phase 9: Documentation & Delivery** - API docs, deployment guide, onboarding guide, and source code packaging
- [ ] **Phase 10: MMS & Attachment Support** - Send and receive images/files through the API with attachment metadata in webhooks
- [ ] **Phase 11: Group Chat Support** - Send to and receive from group chats with participant metadata
- [ ] **Phase 12: Persistent Retry Queue** - Replace in-memory retry queue with file-based persistence to survive restarts
- [ ] **Phase 13: Delivery Status API** - Query endpoint for sent message delivery/read status
- [ ] **Phase 14: Outbound Message Retry** - Retry failed outbound sends when BlueBubbles is temporarily down
- [ ] **Phase 15: Multi-Tenant Architecture** - Centralized management of multiple phone number instances

## Phase Details

### Phase 1: BlueBubbles Setup & Verification
**Goal**: BlueBubbles is installed, configured, and proven working -- iMessages can be sent and received through the BB interface before any wrapper code is written
**Depends on**: Nothing (first phase)
**Requirements**: SETUP-01, SETUP-02, SETUP-03
**Success Criteria** (what must be TRUE):
  1. BlueBubbles Server is installed on the local Mac with Full Disk Access granted to both BlueBubbles and Terminal
  2. A test iMessage can be sent from BlueBubbles to a real phone number and the recipient receives it
  3. An inbound iMessage sent to the Mac's phone number appears in BlueBubbles
  4. The BlueBubbles Private API is enabled and the BB REST API responds to a manual curl request
**Plans**: TBD

Plans:
- [ ] 01-01: TBD

### Phase 2: Project Scaffold & Configuration
**Goal**: A running Express 5 application with environment-driven configuration, structured logging, and credential redaction -- the foundation every subsequent phase builds on
**Depends on**: Phase 1
**Requirements**: SETUP-04, SETUP-05, SECR-04
**Success Criteria** (what must be TRUE):
  1. The Express app starts successfully with all configuration loaded from environment variables (no hardcoded values)
  2. Phone numbers are normalized to E.164 format through a shared utility
  3. BlueBubbles password is redacted from all log output and never appears in any API response
  4. The app fails fast on startup if required environment variables are missing (zod validation)
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Project init, dependencies, TypeScript config, env validation, logging with redaction
- [x] 02-02-PLAN.md — App factory, server entry, phone utility, config files, unit tests

### Phase 3: Send Messaging
**Goal**: Tyler can send iMessages programmatically through POST /send with proper error handling and rate limiting
**Depends on**: Phase 2
**Requirements**: SEND-01, SEND-02, SEND-03, SETUP-06
**Success Criteria** (what must be TRUE):
  1. POST /send with a valid phone number and message body returns a messageId and "queued" status
  2. POST /send with an invalid phone number returns a structured error response with a clear error code
  3. POST /send when BlueBubbles is offline returns a structured error indicating the service is unavailable
  4. Rapid sequential sends are rate-limited with jitter to prevent Apple spam flagging
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Error type system, BlueBubbles API client, token bucket rate limiter, env schema extension
- [x] 03-02-PLAN.md — POST /send route with Zod validation, fire-and-forget jitter send, integration tests

### Phase 4: Read Messaging
**Goal**: Tyler can retrieve conversation lists and message history through the API to display in his CRM
**Depends on**: Phase 2
**Requirements**: READ-01, READ-02, READ-03
**Success Criteria** (what must be TRUE):
  1. GET /conversations returns a list of threads with contact info, last message preview, timestamp, and unread count
  2. GET /conversations/:id returns the full message history for a specific thread
  3. Conversation history supports offset/limit pagination and returns correct pages
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — BB API types, API DTOs, extend BlueBubblesClient with getConversations/getMessages
- [x] 04-02-PLAN.md — Conversation routes with Zod validation, pagination, router mount, integration tests

### Phase 5: Inbound Webhook Pipeline
**Goal**: Tyler's CRM receives a webhook POST for every inbound iMessage, with deduplication and delivery status tracking
**Depends on**: Phase 2
**Requirements**: HOOK-01, HOOK-02, HOOK-04, HOOK-06, SEND-04
**Success Criteria** (what must be TRUE):
  1. When an iMessage is received, a webhook fires to the configured CRM URL with sender, body, timestamp, and thread ID
  2. Duplicate BlueBubbles events for the same message result in only one webhook delivery (dedup buffer working)
  3. last_synced_at is updated in a local JSON file after each successfully processed message
  4. Delivery confirmation events from BlueBubbles (updated-message) are forwarded to the CRM webhook
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Types, dedup buffer, sync state, webhook relay services with tests
- [x] 05-02-PLAN.md — Socket.IO event listener, BB events pipeline, server.ts wiring

### Phase 6: Webhook Reliability & Backfill
**Goal**: No messages are lost -- failed webhook deliveries are retried, and messages missed during downtime are backfilled on reconnect
**Depends on**: Phase 5
**Requirements**: HOOK-03, HOOK-05
**Success Criteria** (what must be TRUE):
  1. When the CRM webhook URL returns an error, the delivery is retried with exponential backoff
  2. After the service restarts, messages received during downtime are queried from BlueBubbles using last_synced_at and delivered to the CRM webhook
  3. The retry queue is bounded (capped at configurable max) to prevent unbounded memory growth
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — Retry queue with exponential backoff, webhook-relay integration, env schema extension
- [x] 06-02-PLAN.md — Backfill service, BB client getMessagesSince, bb-events reconnect trigger, server.ts startup wiring

### Phase 7: Health & Monitoring
**Goal**: Tyler knows the instant something breaks -- the health endpoint reports real status and alerts fire proactively on downtime
**Depends on**: Phase 2
**Requirements**: HLTH-01, HLTH-02, HLTH-03, HLTH-04
**Success Criteria** (what must be TRUE):
  1. GET /health returns the live status of BlueBubbles service, iPhone connection, and iMessage authentication state
  2. GET /health includes macOS version and BlueBubbles version in the response
  3. When BlueBubbles or iMessage goes down, an alert POST fires to the configured alert URL within the configured threshold
  4. The service polls BlueBubbles health periodically to detect silent iMessage sign-outs proactively
**Plans**: 2 plans

Plans:
- [x] 07-01-PLAN.md — Health types, check service, GET /health route, env schema extension
- [x] 07-02-PLAN.md — Health monitor with periodic polling, downtime alerting, server.ts wiring

### Phase 8: Security & Infrastructure
**Goal**: The API is production-hardened with authentication, HTTPS, and automatic process recovery
**Depends on**: Phase 3, Phase 4, Phase 5, Phase 7
**Requirements**: SECR-01, SECR-02, SECR-03
**Success Criteria** (what must be TRUE):
  1. All API endpoints reject requests without a valid Authorization: Bearer token
  2. The API is accessible only through nginx with HTTPS/SSL termination (direct Express port is not exposed)
  3. PM2 automatically restarts the service on crash and on macOS reboot
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Auth middleware with Bearer token validation, error code, env conditional, route restructuring
- [x] 08-02-PLAN.md — Loopback binding, PM2 restart policies, nginx config template, startup script

### Phase 9: Documentation & Delivery
**Goal**: Tyler's team can operate, deploy, and extend the service without Presten's involvement
**Depends on**: Phase 8
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04
**Success Criteria** (what must be TRUE):
  1. API documentation covers every endpoint with request/response formats, error codes, and curl examples
  2. AWS EC2 Mac deployment guide covers instance setup, macOS configuration, BlueBubbles installation, and service deployment
  3. Onboarding guide explains how to add a new phone number (new instance) step by step
  4. Source code is packaged and ready for ownership transfer to Tyler's team
**Plans**: 2 plans

Plans:
- [ ] 09-01-PLAN.md — API documentation with endpoint reference, error codes, auth, and curl examples
- [x] 09-02-PLAN.md — Deployment guide, onboarding guide, handoff docs, README, env completeness

### Phase 10: MMS & Attachment Support
**Goal**: Tyler can send and receive images/files through the API, with attachment metadata included in webhook payloads
**Depends on**: Phase 5, Phase 8
**Requirements**: EMSG-01
**Success Criteria** (what must be TRUE):
  1. Inbound webhook payloads include attachment metadata (URL, mime type, filename, size) when a message has attachments
  2. POST /send supports sending images/files by accepting a file URL or base64-encoded content
  3. Attachments received via BlueBubbles can be downloaded through a proxy endpoint or direct URL
  4. Existing text-only message flow is unaffected (backward compatible)
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md — Types, webhook-relay attachment enrichment, backfill attachment metadata
- [ ] 10-02-PLAN.md — Multer upload middleware, sendAttachment/downloadAttachment BB client, attachment proxy route, multipart POST /send

### Phase 11: Group Chat Support
**Goal**: Tyler can send messages to group chats and receive group messages with participant metadata in webhooks
**Depends on**: Phase 5, Phase 10
**Requirements**: EMSG-02
**Success Criteria** (what must be TRUE):
  1. POST /send supports sending to group chats by accepting a group chat identifier
  2. Inbound webhook payloads for group messages include the group ID, sender, and participant list
  3. GET /conversations distinguishes group chats from 1:1 threads
  4. Existing 1:1 message flow is unaffected (backward compatible)
**Plans**: TBD

Plans:
- [ ] 11-01: TBD

### Phase 12: Persistent Retry Queue
**Goal**: Failed webhook deliveries survive process restarts so no messages are lost during combined CRM downtime + service restart
**Depends on**: Phase 6
**Requirements**: EOPS-05
**Success Criteria** (what must be TRUE):
  1. Retry queue entries are persisted to a local file (JSON or SQLite)
  2. On process restart, pending retries are loaded and processing resumes automatically
  3. Retry behavior (exponential backoff, max attempts, queue bounds) is unchanged from the in-memory implementation
  4. Existing retry flow is unaffected when the queue is empty
**Plans**: 1 plan

Plans:
- [ ] 12-01-PLAN.md — Add file persistence to RetryQueue with atomic writes, wire async init/shutdown

### Phase 13: Delivery Status API
**Goal**: Tyler can query the delivery status of sent messages through the API instead of relying solely on webhook events
**Depends on**: Phase 5
**Requirements**: EOPS-06
**Success Criteria** (what must be TRUE):
  1. GET /messages/:id/status returns the current delivery state (sent, delivered, read, failed)
  2. Delivery status is tracked from updated-message webhook events and stored locally
  3. Status entries have a configurable TTL and are automatically cleaned up
  4. The endpoint returns a clear response when no status is known for a given message
**Plans**: 2 plans

Plans:
- [ ] 13-01-PLAN.md — StatusStore service with TTL cleanup, DeliveryStatus type, env config, unit tests
- [ ] 13-02-PLAN.md — GET /messages/:id/status route, bb-events/send.ts StatusStore integration, router mount

### Phase 14: Outbound Message Retry
**Goal**: When BlueBubbles is temporarily down, outbound send requests are queued and retried instead of silently failing
**Depends on**: Phase 3
**Requirements**: EOPS-07
**Success Criteria** (what must be TRUE):
  1. POST /send returns "queued" status and queues the message when BlueBubbles is unreachable
  2. Queued messages are retried with exponential backoff when BlueBubbles comes back online
  3. The outbound queue is bounded (configurable max) to prevent unbounded growth
  4. Queue state survives process restarts (uses same persistence as Phase 12 if available)
**Plans**: 1 plan

Plans:
- [ ] 14-01-PLAN.md — OutboundRetryQueue service, send.ts BB_OFFLINE routing, server wiring, env config, tests

### Phase 15: Multi-Tenant Architecture
**Goal**: Multiple phone numbers can be managed through a single control plane instead of independent PM2 processes
**Depends on**: Phase 8
**Requirements**: EOPS-04
**Success Criteria** (what must be TRUE):
  1. A management API endpoint lists all active instances with their health status
  2. New phone number instances can be provisioned through the API or config file
  3. Health monitoring aggregates status across all instances
  4. Each instance retains independent BlueBubbles connections and API keys
**Plans**: TBD

Plans:
- [ ] 15-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9
Note: Phases 3, 4, 5, and 7 all depend on Phase 2 and can be developed in any order after it.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. BlueBubbles Setup & Verification | 0/? | Not started | - |
| 2. Project Scaffold & Configuration | 2/2 | Complete | 2026-03-30 |
| 3. Send Messaging | 1/2 | In Progress|  |
| 4. Read Messaging | 1/2 | In Progress|  |
| 5. Inbound Webhook Pipeline | 1/2 | In Progress|  |
| 6. Webhook Reliability & Backfill | 1/2 | In Progress|  |
| 7. Health & Monitoring | 2/2 | Complete   | 2026-03-30 |
| 8. Security & Infrastructure | 2/2 | Complete   | 2026-03-31 |
| 9. Documentation & Delivery | 1/2 | In Progress|  |
| 10. MMS & Attachment Support | 0/2 | Not started | - |
