---
phase: 03
slug: send-messaging
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.2 |
| **Config file** | vitest.config.ts (exists from Phase 2) |
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
| 03-01-01 | 01 | 0 | SEND-01 | integration | `npx vitest run src/routes/__tests__/send.test.ts -t "returns messageId"` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | SEND-02 | unit+integration | `npx vitest run src/routes/__tests__/send.test.ts -t "invalid phone"` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 0 | SEND-02 | unit | `npx vitest run src/services/__tests__/bluebubbles.test.ts -t "offline"` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 0 | SEND-03 | integration | `npx vitest run src/routes/__tests__/send.test.ts -t "queued"` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 0 | SETUP-06 | unit | `npx vitest run src/services/__tests__/rate-limiter.test.ts -t "exhausted"` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 0 | SETUP-06 | unit | `npx vitest run src/services/__tests__/rate-limiter.test.ts -t "jitter"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/types/__tests__/error-codes.test.ts` — covers error code type safety
- [ ] `src/services/__tests__/bluebubbles.test.ts` — covers BB client offline detection, send, response parsing
- [ ] `src/services/__tests__/rate-limiter.test.ts` — covers token bucket consume, refill, jitter ranges
- [ ] `src/routes/__tests__/send.test.ts` — covers POST /send integration (mock BB client)
- [ ] `src/middleware/__tests__/error-handler.test.ts` — extend existing tests for AppError with code + retryable

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real iMessage sent via BB | SEND-01 | Requires live BlueBubbles + iPhone | Send via curl to running instance, verify recipient receives |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
