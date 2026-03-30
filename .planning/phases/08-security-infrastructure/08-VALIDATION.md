---
phase: 08
slug: security-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 08 — Validation Strategy

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
| 08-01-01 | 01 | 0 | SECR-01 | unit | `npx vitest run src/middleware/__tests__/auth.test.ts -t "valid token"` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 0 | SECR-01 | unit | `npx vitest run src/middleware/__tests__/auth.test.ts -t "missing"` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 0 | SECR-01 | unit | `npx vitest run src/middleware/__tests__/auth.test.ts -t "no API_KEY"` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 0 | SECR-01 | unit | `npx vitest run src/middleware/__tests__/auth.test.ts -t "health"` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src/middleware/__tests__/auth.test.ts` — covers SECR-01

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| nginx config valid | SECR-02 | Config template, not live | Inspect deploy/nginx/bluebubbles-api.conf |
| PM2 restart policies | SECR-03 | Runtime behavior | Inspect ecosystem.config.js, test pm2 start/kill |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
