---
phase: 05-inbound-webhook-pipeline
plan: 02
subsystem: bb-events-pipeline
tags: [socket.io, event-pipeline, dedup, webhook-relay, tdd]
dependency_graph:
  requires: [DedupBuffer, relayToCRM, mapInboundMessage, mapDeliveryConfirmation, writeSyncState, BBSocketMessage]
  provides: [initBBEvents, shutdownBBEvents]
  affects: [06-retry-pipeline]
tech_stack:
  added: [socket.io-client]
  patterns: [Socket.IO event listener, module-level singleton, try/catch non-crashing handlers]
key_files:
  created: [src/services/bb-events.ts, src/services/__tests__/bb-events.test.ts]
  modified: [package.json, package-lock.json, src/server.ts]
decisions:
  - "Module-level socket/dedup singletons for lifecycle management via init/shutdown"
  - "connect_error logs message only (no error object) per SECR-04"
  - "updated-message only processes isFromMe=true for delivery confirmations"
metrics:
  duration: 2min
  completed: "2026-03-30T20:55:00Z"
---

# Phase 05 Plan 02: BB Events Socket.IO Pipeline Summary

Socket.IO event listener connecting to BlueBubbles with password auth, processing new-message and updated-message events through dedup/map/relay/sync pipeline, initialized from server.ts on startup.

## What Was Built

- **src/services/bb-events.ts**: Core event pipeline service with `initBBEvents()` and `shutdownBBEvents()`. Connects to BlueBubbles via Socket.IO with password auth and exponential backoff reconnection (1s-30s, infinite attempts). Registers handlers for `new-message` and `updated-message` events.
- **new-message handler**: Filters outbound (isFromMe=true), deduplicates by GUID, maps to InboundMessagePayload, relays to CRM, updates sync state.
- **updated-message handler**: Only processes isFromMe=true messages (delivery confirmations for our sent messages), deduplicates, maps to DeliveryConfirmationPayload, relays to CRM.
- **server.ts wiring**: `initBBEvents()` called inside `app.listen()` callback after server starts.
- **socket.io-client**: Added as production dependency.

## Decisions Made

1. Module-level `socket` and `dedup` singletons managed via init/shutdown lifecycle functions -- simple, testable, matches existing patterns (getBBClient singleton).
2. `connect_error` handler logs generic message without error object to prevent credential leakage (SECR-04 compliance).
3. `updated-message` handler only processes `isFromMe=true` -- delivery confirmations are only relevant for our sent messages per SEND-04.

## Commit Log

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 4fd09aa | chore(05-02): install socket.io-client dependency |
| 2 (RED) | 1338e3e | test(05-02): add failing tests for BB events service |
| 2 (GREEN) | 3cb97d6 | feat(05-02): implement BB events service with Socket.IO pipeline |

## Test Results

- **15 new tests** in `src/services/__tests__/bb-events.test.ts`
- **116 total tests passing** across 12 test files (0 regressions)
- Coverage: init/connect, event registration, new-message pipeline (inbound filter, dedup, relay, sync), updated-message pipeline (outbound filter, dedup, delivery confirmation), error handling (non-crashing), shutdown/cleanup

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all data flows are fully wired to Plan 01 services.

## Self-Check: PASSED
