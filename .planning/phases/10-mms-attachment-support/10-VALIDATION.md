---
phase: 10
slug: mms-attachment-support
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-03
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~1 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | EMSG-01 | unit | `npx vitest run src/types` | ✅ | ⬜ pending |
| 10-01-02 | 01 | 1 | EMSG-01 | unit | `npx vitest run src/services/__tests__/webhook-relay.test.ts` | ✅ | ⬜ pending |
| 10-02-01 | 02 | 2 | EMSG-01 | integration | `npx vitest run src/routes/__tests__/send.test.ts` | ✅ | ⬜ pending |
| 10-02-02 | 02 | 2 | EMSG-01 | integration | `npx vitest run src/routes/__tests__/attachments.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/routes/__tests__/attachments.test.ts` — stubs for attachment download proxy endpoint
- [ ] `src/services/__tests__/bluebubbles.test.ts` — extend with attachment send tests

*Existing infrastructure covers most phase requirements. Only new test files needed for new endpoints.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Actual MMS delivery via BB | EMSG-01 | Requires live BlueBubbles + iPhone | Send attachment via curl, verify received on phone |
| Attachment download from BB | EMSG-01 | Requires live BB with stored attachment | Upload image, hit proxy endpoint, verify binary matches |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
