---
phase: 02
slug: project-scaffold-configuration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.2 |
| **Config file** | vitest.config.ts -- needs creation in Wave 0 |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | SETUP-04 | unit | `npx vitest run src/config/__tests__/env.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | SETUP-05 | unit | `npx vitest run src/utils/__tests__/phone.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | SECR-04 | unit | `npx vitest run src/middleware/__tests__/logger.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 0 | SECR-04 | unit | `npx vitest run src/middleware/__tests__/error-handler.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — test framework config
- [ ] `src/config/__tests__/env.test.ts` — stubs for SETUP-04
- [ ] `src/utils/__tests__/phone.test.ts` — stubs for SETUP-05
- [ ] `src/middleware/__tests__/logger.test.ts` — stubs for SECR-04
- [ ] `src/middleware/__tests__/error-handler.test.ts` — stubs for SECR-04
- [ ] Framework install: `npm install -D vitest`

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
