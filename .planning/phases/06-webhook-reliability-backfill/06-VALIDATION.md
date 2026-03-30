---
phase: 06
slug: webhook-reliability-backfill
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 06 — Validation Strategy

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
| 06-01-01 | 01 | 0 | HOOK-03 | unit | `npx vitest run src/services/__tests__/retry-queue.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 0 | HOOK-03 | unit | `npx vitest run src/services/__tests__/webhook-relay.test.ts` | ✅ (update) | ⬜ pending |
| 06-01-03 | 01 | 0 | HOOK-05 | unit | `npx vitest run src/services/__tests__/backfill.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 0 | HOOK-05 | unit | `npx vitest run src/services/__tests__/bb-events.test.ts` | ✅ (update) | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src/services/__tests__/retry-queue.test.ts` — covers HOOK-03
- [ ] `src/services/__tests__/backfill.test.ts` — covers HOOK-05

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Backfill after real downtime | HOOK-05 | Requires stopping/restarting with BB running | Stop service, send messages to BB, restart, verify backfill fires |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
