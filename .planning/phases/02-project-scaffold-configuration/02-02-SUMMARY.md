---
phase: 02-project-scaffold-configuration
plan: 02
subsystem: app-scaffold
tags: [express, phone-utility, vitest, security, e164]
dependency_graph:
  requires: [02-01]
  provides: [app-factory, server-entry, phone-normalization, test-suite]
  affects: [03-send-endpoint, 04-read-endpoint, 05-webhook-pipeline]
tech_stack:
  added: [vitest, helmet]
  patterns: [app-factory, fail-fast-config, e164-normalization, credential-redaction-tests]
key_files:
  created:
    - src/utils/phone.ts
    - src/routes/index.ts
    - src/app.ts
    - src/server.ts
    - .env.example
    - ecosystem.config.js
    - vitest.config.ts
    - src/__tests__/setup.ts
    - src/config/__tests__/env.test.ts
    - src/utils/__tests__/phone.test.ts
    - src/middleware/__tests__/logger.test.ts
    - src/middleware/__tests__/error-handler.test.ts
  modified:
    - src/config/env.ts
    - src/middleware/error-handler.ts
    - package.json
decisions:
  - Exported envSchema from env.ts for isolated Zod testing without triggering module-level process.exit
  - Used vitest setupFiles to set process.env before module imports (prevents env validation crash in tests)
  - Error handler returns generic message for 500 errors instead of raw err.message (SECR-04 defense in depth)
metrics:
  duration: 3min
  completed: "2026-03-30T18:31:00Z"
  tasks: 2
  files: 15
---

# Phase 02 Plan 02: App Scaffold, Phone Utility, and Test Suite Summary

Express 5 app factory wired with helmet/JSON/pino-http/error-handler, E.164 phone normalization via libphonenumber-js, PM2 multi-instance config, and 16 passing vitest tests covering env validation, phone normalization, logger redaction, and SECR-04 credential safety.

## What Was Done

### Task 1: App Factory, Server Entry, Phone Utility, Config Files (a9b9ab9)

- **src/utils/phone.ts**: `normalizePhone()` wraps libphonenumber-js, returns E.164 format, throws on invalid input
- **src/app.ts**: `createApp()` factory registers helmet, express.json(), pino-http logger, route aggregator, and error handler in correct order
- **src/server.ts**: Entry point imports config first (fail-fast), creates app, listens on configured PORT
- **src/routes/index.ts**: Route aggregator placeholder exporting `router` for Phase 3+ endpoints
- **.env.example**: Documents all 10 environment variables with placeholder values
- **ecosystem.config.js**: PM2 config with `bb-tyler-iphone` instance pattern, env_file per device

### Task 2: Vitest Config and Unit Tests (31a18da)

- **vitest.config.ts**: Test runner configured with setupFiles for env var injection
- **src/config/__tests__/env.test.ts** (6 tests): Validates Zod schema transforms PORT to number, ENABLE_PRETTY_LOGS to boolean, rejects missing BLUEBUBBLES_URL, verifies D-08 boolean coercion
- **src/utils/__tests__/phone.test.ts** (5 tests): US/international E.164 normalization, invalid input rejection
- **src/middleware/__tests__/logger.test.ts** (2 tests): Pino redaction of password and bluebubbles_password fields
- **src/middleware/__tests__/error-handler.test.ts** (3 tests): SECR-04 credential leak prevention, structured error JSON, generic 500 messages
- **src/config/env.ts**: Exported `envSchema` for isolated schema testing
- **src/middleware/error-handler.ts**: Returns generic "Internal server error" for status >= 500 (defense in depth)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest env var injection timing**
- **Found during:** Task 2
- **Issue:** vitest `env` config option doesn't set process.env early enough -- env.ts module-level validation runs before env vars are applied, causing process.exit(1)
- **Fix:** Created `src/__tests__/setup.ts` as a vitest setupFile that sets process.env before any module imports
- **Files modified:** vitest.config.ts, src/__tests__/setup.ts
- **Commit:** 31a18da

**2. [Rule 1 - Bug] Invalid LOG_LEVEL in test setup**
- **Found during:** Task 2
- **Issue:** Used LOG_LEVEL='silent' which is not in the Zod enum (valid: fatal/error/warn/info/debug/trace)
- **Fix:** Changed to LOG_LEVEL='error' in test setup
- **Files modified:** src/__tests__/setup.ts
- **Commit:** 31a18da

## Verification Results

- `npx tsc --noEmit` -- exits 0 (clean compile)
- `npx vitest run` -- 16/16 tests pass, 4 test files
- `npm run build` -- dist/ created with all .js files
- All acceptance criteria met

## Known Stubs

None -- all code is fully wired and functional.

## Self-Check: PASSED

- All 12 created files verified present
- Commits a9b9ab9 and 31a18da verified in git log
