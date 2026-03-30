---
phase: 04
slug: read-messaging
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 04 — Validation Strategy

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
| 04-01-01 | 01 | 0 | READ-01 | integration | `npx vitest run src/routes/__tests__/conversations.test.ts -t "conversations list"` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 0 | READ-02 | integration | `npx vitest run src/routes/__tests__/conversations.test.ts -t "message history"` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 0 | READ-03 | integration | `npx vitest run src/routes/__tests__/conversations.test.ts -t "pagination"` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 0 | READ-01 | unit | `npx vitest run src/services/__tests__/bluebubbles.test.ts -t "getConversations"` | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 0 | READ-02 | unit | `npx vitest run src/services/__tests__/bluebubbles.test.ts -t "getMessages"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/routes/__tests__/conversations.test.ts` — covers READ-01, READ-02, READ-03
- [ ] `src/services/__tests__/bluebubbles.test.ts` — extend for getConversations, getMessages

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real conversation data from BB | READ-01 | Requires live BlueBubbles | GET /conversations against running instance |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
