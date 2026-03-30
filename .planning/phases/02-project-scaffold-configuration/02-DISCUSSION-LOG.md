# Phase 2: Project Scaffold & Configuration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 02-project-scaffold-configuration
**Areas discussed:** Language & runtime, Project structure, Logging & redaction, Config & validation

---

## Language & Runtime

| Option | Description | Selected |
|--------|-------------|----------|
| TypeScript (compiled) | Compile-time safety, self-documenting interfaces. Industry standard for Node APIs. Best for handoff quality. | ✓ |
| JavaScript + JSDoc | No build step, IDE type hints via @ts-check. Good middle ground if client team is JS-only. | |
| Plain JavaScript | Simplest possible stack. No type safety -- relies on docs and naming conventions. | |

**User's choice:** TypeScript (Recommended)
**Notes:** None -- immediate selection.

---

## Project Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Layered (routes/services/middleware) | Industry standard, clean separation, easy handoff. | ✓ |
| Flat | Everything in src/ -- simple but gets messy as endpoints grow. | |
| Feature-based | src/send/, src/conversations/, src/health/ -- co-located but overkill for 5 route groups. | |

**User's choice:** Layered (Recommended)
**Notes:** None -- immediate selection.

---

## Logging & Redaction

| Option | Description | Selected |
|--------|-------------|----------|
| Pino + pino-http | Built-in redact config for credential safety (SECR-04), fastest Node logger, native Express middleware, JSON output works with PM2. | ✓ |
| Winston + custom sanitizer | More familiar to most Node devs, flexible transports. Requires hand-rolled sanitizer for credential redaction. | |

**User's choice:** Pino (Recommended)
**Notes:** None -- immediate selection.

---

## Config & Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Zod + per-instance .env files | Single dep for env + request validation, TS-inferred types, fail-fast. Per-instance .env files. | ✓ |
| envalid + .env files | Purpose-built env validator. Adds a separate dep from Zod. | |
| PM2 ecosystem.config.js only | All config in one JS file per instance. Credentials in plaintext on disk. | |

**User's choice:** Zod + .env files (Recommended)
**Notes:** None -- immediate selection.

---

## Claude's Discretion

- Express 5 specific configuration (router setup, error handling middleware patterns)
- tsconfig.json settings
- Package manager choice
- Test framework selection

## Deferred Ideas

None -- discussion stayed within phase scope.
