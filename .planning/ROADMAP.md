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
- [ ] **Phase 7: Health & Monitoring** - Deep health checks and proactive downtime alerting
- [ ] **Phase 8: Security & Infrastructure** - API key auth, nginx reverse proxy, SSL, and PM2 process management
- [ ] **Phase 9: Documentation & Delivery** - API docs, deployment guide, onboarding guide, and source code packaging

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
- [ ] 05-01: TBD

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
- [ ] 06-01: TBD

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
- [ ] 07-01: TBD

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
- [ ] 08-01: TBD

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
- [ ] 09-01: TBD

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
| 5. Inbound Webhook Pipeline | 0/? | Not started | - |
| 6. Webhook Reliability & Backfill | 0/? | Not started | - |
| 7. Health & Monitoring | 0/? | Not started | - |
| 8. Security & Infrastructure | 0/? | Not started | - |
| 9. Documentation & Delivery | 0/? | Not started | - |
