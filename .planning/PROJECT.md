# BlueBubbles iMessage API

## What This Is

A production-ready iMessage/SMS REST API service built on top of BlueBubbles for client Tyler at Elk Ridge Investments. Tyler needs a Twilio-like messaging layer he can call from his CRM — send messages, receive them via webhook, pull conversation history, and monitor device health. This is a POC scoped to the messaging layer only.

## Core Value

Tyler can send and receive iMessages programmatically through a clean REST API, with reliable webhook delivery for inbound messages and health monitoring so he knows when something breaks.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] BlueBubbles installed and verified locally (send/receive working before any code)
- [ ] POST /send — send iMessage to phone number, return messageId, structured errors on failure
- [ ] GET /conversations — list all threads (contact, last message, timestamp, unread count)
- [ ] GET /conversations/:id — full message history with pagination
- [ ] GET /health — real-time status of BlueBubbles, iPhone connection, iMessage auth
- [ ] Inbound webhook — fires to configurable URL on every received message (sender, body, timestamp, thread ID)
- [ ] Webhook retry with exponential backoff on failed deliveries
- [ ] Backfill on reconnect — query BlueBubbles for messages since last_synced_at, fire to webhook
- [ ] last_synced_at stored in local JSON file (no database)
- [ ] Downtime alerting — POST to configurable alert URL if service offline beyond threshold
- [ ] API key auth (Authorization: Bearer header) on all endpoints
- [ ] Nginx reverse proxy with HTTPS/SSL
- [ ] PM2 process management for uptime across reboots
- [ ] Multi-instance ready — one instance per phone number, no hardcoded values
- [ ] AWS EC2 Mac deployment guide
- [ ] API documentation for all endpoints
- [ ] Onboarding guide for adding new devices
- [ ] Source code packaged for ownership transfer

### Out of Scope

- Database on our side — Tyler handles all persistence
- AI/ML features — not part of this POC
- Frontend/UI — API only
- Mobile app — this is a server-side service
- Group chat support — individual threads only for POC
- MMS/media messages — text only for POC (unless BlueBubbles handles it trivially)
- Multi-tenant auth — single API key per instance is sufficient

## Context

**Technical environment:**
- Apple locks iMessage to macOS hardware — BlueBubbles is the bridge
- BlueBubbles (https://github.com/BlueBubblesApp/bluebubbles-app) runs on Mac, connects to Messages app, exposes REST API + websocket
- BlueBubbles handles ~70% of the work (send, receive, conversation history, webhook events)
- Our job: clean, hardened production wrapper with auth, retry logic, health monitoring, and deployment tooling

**Stack:**
- Mac running 24/7 with BlueBubbles server
- Apple ID signed into iMessage (same as Tyler's iPhone)
- Node.js / Express wrapper on top of BlueBubbles API
- Nginx reverse proxy + HTTPS + API key auth
- PM2 for process management

**Development approach:**
- Build and test locally on Mac first
- Write AWS EC2 Mac deployment guide as deliverable (not deploying during dev)
- EC2 Mac: dedicated Apple hardware, 24hr min billing, ~$750-900/mo per instance, client pays AWS directly

**Known risks:**
- BlueBubbles is community-maintained — Apple updates may break it
- This is a known risk Tyler accepts
- Monitor BlueBubbles GitHub for breaking changes

**Linear project:**
- Tyler BlueBubbles Project, Elk Ridge Investments team
- Tickets ELK-5 through ELK-15
- 5 phases in Linear (our roadmap will be more detailed but aligned)

## Constraints

- **Platform**: Must run on macOS (Apple hardware requirement for iMessage)
- **No database**: Local JSON file for last_synced_at only — Tyler handles persistence
- **Multi-instance**: Architecture must support one instance per phone number with no hardcoded values
- **Security**: HTTPS only, API key auth on all endpoints
- **Dependency**: BlueBubbles community project — we don't control upstream updates

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| BlueBubbles as iMessage bridge | Only viable option for programmatic iMessage access on macOS | — Pending |
| Node/Express for wrapper | Lightweight, Tyler's team can maintain, good BlueBubbles API client support | — Pending |
| No database | Tyler handles persistence, keeps our layer stateless except last_synced_at | — Pending |
| Local JSON for last_synced_at | Simplest approach for single timestamp, no DB dependency | — Pending |
| Local dev first, deployment guide later | Faster iteration, EC2 Mac is expensive ($750-900/mo) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-30 after initialization*
