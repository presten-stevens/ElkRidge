---
phase: 05
slug: inbound-webhook-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.2 |
| **Config file** | vitest.config.ts (exists) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 0 | HOOK-01 | unit | `npx vitest run src/services/__tests__/bb-events.test.ts -t "relays inbound"` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 0 | HOOK-02 | unit | `npx vitest run src/services/__tests__/webhook-relay.test.ts -t "payload"` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 0 | HOOK-04 | unit | `npx vitest run src/services/__tests__/dedup.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 0 | HOOK-06 | unit | `npx vitest run src/services/__tests__/sync-state.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-05 | 01 | 0 | SEND-04 | unit | `npx vitest run src/services/__tests__/bb-events.test.ts -t "delivery"` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src/services/__tests__/bb-events.test.ts` — covers HOOK-01, SEND-04
- [ ] `src/services/__tests__/webhook-relay.test.ts` — covers HOOK-02
- [ ] `src/services/__tests__/dedup.test.ts` — covers HOOK-04
- [ ] `src/services/__tests__/sync-state.test.ts` — covers HOOK-06

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real BB WebSocket connection | HOOK-01 | Requires live BB server | Start app with BB running, send iMessage, verify CRM webhook fires |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
