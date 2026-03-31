# Requirements: BlueBubbles iMessage API

**Defined:** 2026-03-30
**Core Value:** Tyler can send and receive iMessages programmatically through a clean REST API, with reliable webhook delivery and health monitoring.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Setup & Foundation

- [ ] **SETUP-01**: BlueBubbles Server installed on local Mac with Full Disk Access granted
- [ ] **SETUP-02**: iMessage send/receive verified manually through BlueBubbles before writing code
- [ ] **SETUP-03**: BlueBubbles Private API enabled and confirmed working
- [x] **SETUP-04**: Environment-driven configuration (no hardcoded values) supporting one instance per phone number
- [x] **SETUP-05**: Phone numbers normalized to E.164 international format on all inbound/outbound operations
- [x] **SETUP-06**: Outbound message rate limiting with jitter to avoid Apple spam flagging

### Send Messaging

- [x] **SEND-01**: POST /send endpoint accepts phone number and message body, returns messageId
- [x] **SEND-02**: Send endpoint returns structured error responses (invalid number, BB offline, auth failure)
- [x] **SEND-03**: Send response indicates "queued" status (not "delivered") to reflect actual iMessage behavior
- [x] **SEND-04**: Delivery confirmation tracked via updated-message webhook events from BlueBubbles

### Read Messaging

- [x] **READ-01**: GET /conversations returns all threads with contact, last message, timestamp, unread count
- [x] **READ-02**: GET /conversations/:id returns full message history for a thread
- [x] **READ-03**: Conversation history supports pagination (offset/limit)

### Inbound Webhooks

- [x] **HOOK-01**: Inbound webhook fires to configurable URL on every received message
- [x] **HOOK-02**: Webhook payload includes sender, body, timestamp, and thread ID
- [x] **HOOK-03**: Webhook retry with exponential backoff on failed deliveries
- [x] **HOOK-04**: Message deduplication buffer prevents duplicate webhook fires (BlueBubbles sends 2-3 events per message)
- [x] **HOOK-05**: Backfill on reconnect — query BlueBubbles for messages since last_synced_at, fire to webhook
- [x] **HOOK-06**: last_synced_at persisted in local JSON file (no database)

### Health & Monitoring

- [x] **HLTH-01**: GET /health returns real-time status of BlueBubbles service, iPhone connection, and iMessage auth state
- [x] **HLTH-02**: Health endpoint includes macOS version and BlueBubbles version
- [x] **HLTH-03**: Downtime alerting — POST to configurable alert URL if service offline beyond configurable threshold
- [x] **HLTH-04**: Periodic health polling to detect iMessage sign-out or BB disconnect proactively

### Security & Infrastructure

- [x] **SECR-01**: API key authentication via Authorization: Bearer header on all endpoints
- [x] **SECR-02**: Nginx reverse proxy configured with HTTPS/SSL termination
- [x] **SECR-03**: PM2 process management for uptime across reboots
- [x] **SECR-04**: BlueBubbles password never exposed in API responses or logs (credential redaction)

### Documentation & Delivery

- [ ] **DOCS-01**: API documentation covering all endpoints (request/response formats, error codes, examples)
- [ ] **DOCS-02**: AWS EC2 Mac deployment guide (instance setup, macOS config, BB install, service deployment)
- [ ] **DOCS-03**: Onboarding guide for adding new devices/phone numbers
- [ ] **DOCS-04**: Source code packaged for ownership transfer to client

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Messaging

- **EMSG-01**: MMS/media message support (images, attachments)
- **EMSG-02**: Group chat support
- **EMSG-03**: Message edit/unsend support (risky — macOS updates break this)
- **EMSG-04**: Read receipt tracking
- **EMSG-05**: Typing indicator support

### Enhanced Operations

- **EOPS-01**: Webhook delivery status dashboard
- **EOPS-02**: Message delivery analytics
- **EOPS-03**: Auto-restart BlueBubbles on crash detection
- **EOPS-04**: Multi-instance management API (centralized control of multiple phone numbers)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Database on our side | Tyler handles all persistence — we only store last_synced_at in JSON |
| AI/ML features | Not part of this POC |
| Frontend/UI | API only — Tyler integrates from his CRM |
| Mobile app | Server-side service only |
| OAuth/multi-tenant auth | Single API key per instance is sufficient for POC |
| Message scheduling | Tyler's CRM handles timing — we just send when called |
| Contact management | Tyler's CRM owns contact data |
| Auto-update BlueBubbles | Pin BB version — auto-updates risk breaking production |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SETUP-01 | Phase 1 | Pending |
| SETUP-02 | Phase 1 | Pending |
| SETUP-03 | Phase 1 | Pending |
| SETUP-04 | Phase 2 | Complete |
| SETUP-05 | Phase 2 | Complete |
| SETUP-06 | Phase 3 | Complete |
| SEND-01 | Phase 3 | Complete |
| SEND-02 | Phase 3 | Complete |
| SEND-03 | Phase 3 | Complete |
| SEND-04 | Phase 5 | Complete |
| READ-01 | Phase 4 | Complete |
| READ-02 | Phase 4 | Complete |
| READ-03 | Phase 4 | Complete |
| HOOK-01 | Phase 5 | Complete |
| HOOK-02 | Phase 5 | Complete |
| HOOK-03 | Phase 6 | Complete |
| HOOK-04 | Phase 5 | Complete |
| HOOK-05 | Phase 6 | Complete |
| HOOK-06 | Phase 5 | Complete |
| HLTH-01 | Phase 7 | Complete |
| HLTH-02 | Phase 7 | Complete |
| HLTH-03 | Phase 7 | Complete |
| HLTH-04 | Phase 7 | Complete |
| SECR-01 | Phase 8 | Complete |
| SECR-02 | Phase 8 | Complete |
| SECR-03 | Phase 8 | Complete |
| SECR-04 | Phase 2 | Complete |
| DOCS-01 | Phase 9 | Pending |
| DOCS-02 | Phase 9 | Pending |
| DOCS-03 | Phase 9 | Pending |
| DOCS-04 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after roadmap creation*
