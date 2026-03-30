# Phase 2: Project Scaffold & Configuration - Research

**Researched:** 2026-03-30
**Domain:** Express 5 + TypeScript scaffold, env validation, structured logging, credential redaction
**Confidence:** HIGH

## Summary

This phase establishes the foundation for every subsequent phase: an Express 5 application written in TypeScript, compiled with `tsc`, configured entirely through environment variables validated at startup by Zod, with structured logging via Pino that redacts the BlueBubbles password before serialization. A shared E.164 phone number normalization utility rounds out the scaffold.

The stack is verified and current. Express 5.2.1 is stable with native async error handling (no wrapper needed). Pino 10.3.1 provides declarative redaction paths that strip credentials before they reach any transport. Zod 4.3.6 infers TypeScript types directly from env schemas. Node 24.3.0 is available on this machine with native TypeScript type-stripping (enabled by default), but the user decision locks us to `tsc` compilation with `src/` to `dist/` output, which provides the additional benefit of catching type errors at build time rather than only at runtime. `libphonenumber-js` is the standard library for E.164 normalization -- it handles country detection, validation, and formatting in a 145KB package.

**Primary recommendation:** Scaffold the Express 5 app with tsc compilation, Zod env validation that fails fast, Pino with declarative redact paths for BlueBubbles password, and a thin `normalizePhone()` utility wrapping `libphonenumber-js`. Keep routes thin, business logic in services, cross-cutting concerns in middleware.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** TypeScript (compiled). Use `tsc` for builds. All source in `src/`, compiled output in `dist/`. This gives compile-time safety, self-documenting interfaces for request/response shapes, and clean handoff to Tyler's team.
- **D-02:** Layered architecture with sibling directories: `src/routes/`, `src/services/`, `src/middleware/`, `src/config/`, `src/utils/`. Routes stay thin (HTTP parsing only), business logic lives in services, cross-cutting concerns (logging, redaction, auth) are middleware.
- **D-03:** Pino as the structured logging library. Use `pino-http` for Express request/response logging middleware.
- **D-04:** Credential redaction via Pino's declarative `redact` configuration. Paths like `['*.password', 'req.headers.authorization', '*.bluebubbles_password']` are declared at logger initialization. BlueBubbles password is stripped before serialization, not after. This satisfies SECR-04.
- **D-05:** Use `pino-pretty` for human-readable dev output. JSON output in production (PM2-friendly).
- **D-06:** Zod schema in a single `src/config/env.ts` file validates `process.env` at startup. TypeScript types are inferred from the schema. App fails fast with clear error messages on missing/invalid env vars.
- **D-07:** Per-instance `.env` files for multi-instance support (e.g., `.env.tyler_iphone`, `.env.tyler_android`). PM2's `ecosystem.config.js` references the correct `.env` file per instance.
- **D-08:** Use `.transform()` for boolean env vars, NOT `z.coerce.boolean()` (which parses `"false"` as `true` due to truthy string coercion).
- **D-09:** Zod will also be reused for request body validation in later phases (single dependency for both env and API validation).

### Claude's Discretion
- Express 5 specific configuration (router setup, error handling middleware patterns)
- tsconfig.json settings (target, module resolution)
- Package manager choice (npm vs pnpm vs yarn)
- Test framework selection (if scaffolded in this phase)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SETUP-04 | Environment-driven configuration (no hardcoded values) supporting one instance per phone number | Zod env validation pattern (D-06), per-instance .env files (D-07), Node --env-file flag, PM2 ecosystem config |
| SETUP-05 | Phone numbers normalized to E.164 international format on all inbound/outbound operations | libphonenumber-js library, shared `normalizePhone()` utility in `src/utils/` |
| SECR-04 | BlueBubbles password never exposed in API responses or logs (credential redaction) | Pino declarative redact paths (D-04), wildcard path syntax verified in official docs |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.1 | HTTP framework | Stable v5 with native async error handling, no wrappers needed |
| typescript | 6.0.2 | Type checking + compilation | tsc compiles src/ to dist/ per D-01; catches errors at build time |
| zod | 4.3.6 | Env + request validation | Single schema lib for env vars and future API validation (D-09) |
| pino | 10.3.1 | Structured JSON logging | Declarative redaction, 5-10x faster than Winston, PM2-friendly JSON |
| pino-http | 11.0.0 | Express request/response logging | Auto-logs every request with method, URL, status, duration |
| libphonenumber-js | 1.12.41 | E.164 phone normalization | Google's libphonenumber rewrite, 145KB, handles all countries |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino-pretty | 13.1.3 | Human-readable dev logs | Development only (D-05), not imported in production |
| @types/express | 5.0.6 | Express type definitions | TypeScript compilation |
| @types/node | 25.x | Node.js type definitions | TypeScript compilation |
| helmet | 8.1.0 | Security HTTP headers | Every Express app, zero-config sensible defaults |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsc compilation | Node 24 native type-stripping | Node 24 runs .ts natively (verified on this machine), but D-01 locks tsc. tsc gives build-time type checking + dist/ output for deployment. |
| npm | pnpm | pnpm is faster with better disk efficiency, but npm is already installed (v11.4.2) and simpler for Tyler's team handoff |
| vitest | jest | vitest 4.1.2 is current, native ESM + TypeScript, faster than jest. Recommended if tests scaffolded. |

**Installation:**
```bash
npm init -y
npm install express@5.2.1 zod@4.3.6 pino@10.3.1 pino-http@11.0.0 libphonenumber-js@1.12.41 helmet@8.1.0
npm install -D typescript@6.0.2 @types/express@5.0.6 @types/node@25 pino-pretty@13.1.3
```

**Version verification:** All versions verified via `npm view` on 2026-03-30.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── config/
│   └── env.ts           # Zod schema, parse + export validated config
├── middleware/
│   ├── logger.ts        # Pino + pino-http setup with redaction
│   └── error-handler.ts # Express 5 async error handler
├── routes/
│   └── index.ts         # Route aggregator (empty for now, placeholder)
├── services/            # Business logic (empty for now)
├── utils/
│   └── phone.ts         # E.164 normalization utility
└── app.ts               # Express app factory (createApp)
├── server.ts            # Entry point: load config, create app, listen
tsconfig.json
package.json
.env.example             # Template with all env vars documented
ecosystem.config.js      # PM2 config referencing per-instance .env
```

### Pattern 1: Zod Env Validation with Fail-Fast
**What:** Single Zod schema validates all environment variables at startup. App crashes immediately with descriptive errors if anything is missing or invalid.
**When to use:** Always -- imported as the very first module in `server.ts`.
**Example:**
```typescript
// src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BLUEBUBBLES_URL: z.string().url(),
  BLUEBUBBLES_PASSWORD: z.string().min(1),
  CRM_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  API_KEY: z.string().min(16),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ENABLE_PRETTY_LOGS: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),  // D-08: NOT z.coerce.boolean()
});

// Parse and fail fast
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
```

### Pattern 2: Pino Logger with Declarative Redaction
**What:** Pino instance configured with redact paths that strip credentials before serialization.
**When to use:** Created once in middleware/logger.ts, imported everywhere.
**Example:**
```typescript
// src/middleware/logger.ts
import pino from 'pino';
import pinoHttp from 'pino-http';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      '*.password',
      '*.bluebubbles_password',
      'req.headers.authorization',
      'req.query.password',
    ],
    censor: '[REDACTED]',
  },
  transport: env.ENABLE_PRETTY_LOGS
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export const httpLogger = pinoHttp({ logger });
```

### Pattern 3: Express 5 Async Error Handler
**What:** Express 5 automatically catches rejected promises from async handlers. A final error-handling middleware formats all errors consistently.
**When to use:** Registered as the last middleware after all routes.
**Example:**
```typescript
// src/middleware/error-handler.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error({ err, req }, 'Unhandled error');

  const status = 'status' in err ? (err as any).status : 500;
  res.status(status).json({
    error: {
      message: err.message || 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  });
}
```

### Pattern 4: E.164 Phone Normalization Utility
**What:** Shared utility that parses any phone input and returns E.164 format or throws.
**When to use:** Every route that accepts a phone number parameter.
**Example:**
```typescript
// src/utils/phone.ts
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhone(input: string, defaultCountry: string = 'US'): string {
  const phone = parsePhoneNumberFromString(input, defaultCountry as any);
  if (!phone || !phone.isValid()) {
    throw new Error(`Invalid phone number: ${input}`);
  }
  return phone.number; // E.164 format, e.g., '+12135551234'
}
```

### Pattern 5: App Factory Pattern
**What:** `createApp()` function builds and returns the Express app. Separates app creation from listening, enabling testing.
**When to use:** Always -- `server.ts` calls `createApp()` then `.listen()`.
**Example:**
```typescript
// src/app.ts
import express from 'express';
import helmet from 'helmet';
import { httpLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json());
  app.use(httpLogger);

  // Routes will be added in later phases

  app.use(errorHandler);

  return app;
}
```

### Anti-Patterns to Avoid
- **Hardcoded config values:** Every config value comes from env vars through the Zod schema. Never `const PORT = 3000`.
- **`z.coerce.boolean()` for env vars:** Parses the string `"false"` as truthy (`true`). Use `.transform(val => val === 'true')` instead (D-08).
- **Post-serialization redaction:** Never log first, filter second. Pino's `redact` strips values before JSON serialization.
- **`express-async-errors` package:** Not needed with Express 5 -- async errors are caught natively.
- **`res.send(status)` pattern:** Removed in Express 5. Use `res.sendStatus()` or `res.status(n).send()`.
- **`req.param()` helper:** Removed in Express 5. Use `req.params`, `req.body`, or `req.query` explicitly.
- **Wildcard routes without names:** Express 5 requires named wildcards: `/*splat` not `/*`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Phone number parsing | Regex for phone formats | `libphonenumber-js` | Country detection, validation rules, format edge cases across 200+ countries |
| Env validation | Manual `if (!process.env.X)` checks | Zod schema | Type inference, transform pipelines, structured error messages, reusable for API validation |
| Log redaction | String replacement on log output | Pino `redact` option | Operates before serialization, handles nested paths, zero-overhead wildcard support |
| HTTP security headers | Manual `res.setHeader()` calls | `helmet` | 15+ headers with sensible defaults, maintained by Express team |
| Request logging | Custom `morgan`-style middleware | `pino-http` | Auto-logs req/res with timing, respects Pino redact config, structured JSON |

**Key insight:** This phase is all infrastructure glue. Every component has a battle-tested library. Hand-rolling any of it creates maintenance burden for Tyler's team with zero upside.

## Common Pitfalls

### Pitfall 1: Zod `z.coerce.boolean()` Trap
**What goes wrong:** `z.coerce.boolean()` converts the string `"false"` to `true` because JavaScript `Boolean("false")` is truthy.
**Why it happens:** Intuitive-seeming API with counterintuitive behavior for env var strings.
**How to avoid:** Use `.transform(val => val === 'true')` for all boolean env vars (D-08).
**Warning signs:** Feature flags that cannot be disabled via env vars.

### Pitfall 2: Express 5 Breaking Changes
**What goes wrong:** Code patterns from Express 4 tutorials silently break or behave differently.
**Why it happens:** Express 5 removed several APIs and changed defaults.
**How to avoid:** Key changes to remember:
- `req.body` is `undefined` (not `{}`) when unparsed -- always register `express.json()` before routes
- `req.query` is read-only (getter, not writable)
- `res.status()` only accepts integers 100-999
- `app.listen` callback receives an error argument: `app.listen(port, (err) => { if (err) throw err; })`
- Wildcard routes need names: `/*splat` not `/*`
**Warning signs:** TypeScript type errors on Express 4 patterns, unexpected `undefined` values.

### Pitfall 3: Pino Transport in Production
**What goes wrong:** `pino-pretty` transport loaded in production causes performance degradation and non-parseable logs.
**Why it happens:** Forgetting to conditionalize the transport option.
**How to avoid:** Only set `transport` when `ENABLE_PRETTY_LOGS` is true (development). In production, Pino outputs raw JSON (no transport), which PM2 and log aggregators can parse directly.
**Warning signs:** Colored terminal output in production logs, slower logging throughput.

### Pitfall 4: BlueBubbles Password in URL Query Params
**What goes wrong:** BlueBubbles authenticates via `?password=xxx` query parameter. If any middleware logs the full request URL, the password leaks.
**Why it happens:** Default request logging includes the full URL with query string.
**How to avoid:** The Pino `redact` path `req.query.password` covers structured log fields. Additionally, ensure any URL serialization in custom log messages strips the password query param. The axios request interceptor (Phase 3) should also strip the password from error logs.
**Warning signs:** Password visible in log output when searching for BlueBubbles API calls.

### Pitfall 5: Missing .js Extensions in TypeScript ESM Imports
**What goes wrong:** TypeScript compiles to ESM output but import paths lack `.js` extensions, causing runtime `ERR_MODULE_NOT_FOUND`.
**Why it happens:** TypeScript requires `.js` extensions in source imports when targeting ESM output, even though the source files are `.ts`.
**How to avoid:** All imports must include `.js` extension: `import { env } from '../config/env.js'`. Set `"module": "nodenext"` and `"moduleResolution": "nodenext"` in tsconfig.json.
**Warning signs:** `ERR_MODULE_NOT_FOUND` at runtime despite successful `tsc` compilation.

## Code Examples

### tsconfig.json (Recommended)
```jsonc
// Source: Node.js TypeScript docs + TypeScript handbook
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### package.json Scripts
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "node --watch --env-file=.env src/server.ts",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  }
}
```

**Note on dev script:** Node 24 can run `.ts` files directly via native type-stripping. The `dev` script uses this for fast iteration without compilation. The `build` + `start` scripts use `tsc` for production (D-01). The `--env-file` flag loads `.env` natively (no dotenv dependency needed).

### .env.example
```bash
# BlueBubbles connection
BLUEBUBBLES_URL=http://localhost:1234
BLUEBUBBLES_PASSWORD=your-bb-password-here

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
ENABLE_PRETTY_LOGS=true

# API authentication (Phase 8, but schema accepts it now)
API_KEY=your-api-key-min-16-chars

# Webhooks (optional until Phase 5)
CRM_WEBHOOK_URL=
ALERT_WEBHOOK_URL=
```

### ecosystem.config.js (PM2 Multi-Instance)
```javascript
// Source: PM2 docs
module.exports = {
  apps: [
    {
      name: 'bb-tyler-iphone',
      script: 'dist/server.js',
      env_file: '.env.tyler_iphone',
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
    },
    // Add more instances per phone number
  ],
};
```

### Entry Point (server.ts)
```typescript
// src/server.ts
// Config MUST be imported first -- it fails fast on invalid env
import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './middleware/logger.js';

const app = createApp();

app.listen(env.PORT, (err?: Error) => {
  if (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express 4 + express-async-errors | Express 5 native async handling | Express 5.0.0 (Oct 2024) | No wrapper needed, async throws auto-caught |
| dotenv for .env loading | Node --env-file flag | Node 20.6.0+ | Zero dependency for env file loading |
| Winston for logging | Pino (5-10x faster) | Mainstream since 2022 | Lower latency, better structured JSON, declarative redaction |
| Manual `if (!process.env.X)` | Zod schema validation | Mainstream since 2023 | Type-safe, structured errors, reusable schemas |
| ts-node / tsx for dev | Node 24 native type-stripping | Node 22.6.0+ | Zero dependency TS execution in development |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 (recommended) |
| Config file | vitest.config.ts -- needs creation in Wave 0 |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SETUP-04 | Zod env validation rejects missing vars | unit | `npx vitest run src/config/__tests__/env.test.ts` | No -- Wave 0 |
| SETUP-04 | Zod env validation accepts valid vars | unit | `npx vitest run src/config/__tests__/env.test.ts` | No -- Wave 0 |
| SETUP-05 | normalizePhone returns E.164 for valid input | unit | `npx vitest run src/utils/__tests__/phone.test.ts` | No -- Wave 0 |
| SETUP-05 | normalizePhone throws for invalid input | unit | `npx vitest run src/utils/__tests__/phone.test.ts` | No -- Wave 0 |
| SECR-04 | Pino logger redacts password fields | unit | `npx vitest run src/middleware/__tests__/logger.test.ts` | No -- Wave 0 |
| SECR-04 | Error handler does not leak password | unit | `npx vitest run src/middleware/__tests__/error-handler.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- test framework config
- [ ] `src/config/__tests__/env.test.ts` -- covers SETUP-04
- [ ] `src/utils/__tests__/phone.test.ts` -- covers SETUP-05
- [ ] `src/middleware/__tests__/logger.test.ts` -- covers SECR-04
- [ ] `src/middleware/__tests__/error-handler.test.ts` -- covers SECR-04
- [ ] Framework install: `npm install -D vitest`

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 24.3.0 | -- |
| npm | Package management | Yes | 11.4.2 | -- |
| tsc (typescript) | Build (D-01) | No (install via npm) | Will install 6.0.2 | -- |

**Missing dependencies with no fallback:**
- None -- all dependencies installable via npm.

**Missing dependencies with fallback:**
- None.

## Open Questions

1. **vitest vs no tests in this phase**
   - What we know: CONTEXT.md lists test framework selection as Claude's discretion. vitest 4.1.2 is the current standard for TypeScript projects.
   - What's unclear: Whether tests should be scaffolded in this phase or deferred.
   - Recommendation: Scaffold vitest config and write unit tests for env validation, phone normalization, and redaction in this phase. These are pure functions that are trivially testable and catch regressions early.

2. **PM2 ecosystem.config.js in this phase vs Phase 8**
   - What we know: D-07 mentions PM2 ecosystem config for multi-instance .env support. Phase 8 covers PM2 for process management.
   - What's unclear: Whether the ecosystem.config.js should be created now (for .env file reference) or in Phase 8.
   - Recommendation: Create a minimal ecosystem.config.js in this phase as documentation of the multi-instance pattern. Phase 8 will expand it with restart policies and production settings.

3. **`verbatimModuleSyntax` compatibility with CommonJS dependencies**
   - What we know: `verbatimModuleSyntax` enforces explicit `import type` syntax. Some older packages may have CJS-only type definitions.
   - What's unclear: Whether all dependencies in this stack support ESM properly.
   - Recommendation: Enable it. Express 5, Pino, Zod, and libphonenumber-js all support ESM. If a specific import breaks, the fix is adding `type` to the import statement.

## Sources

### Primary (HIGH confidence)
- [Express.js Migration Guide](https://expressjs.com/en/guide/migrating-5.html) -- Express 5 breaking changes, async error handling, removed APIs
- [Pino Redaction Docs](https://github.com/pinojs/pino/blob/main/docs/redaction.md) -- Path syntax, wildcard support, censor options, performance
- [Node.js TypeScript Docs](https://nodejs.org/en/learn/typescript/run-natively) -- Native type-stripping, tsconfig recommendations
- [npm registry](https://www.npmjs.com/) -- All package versions verified via `npm view` on 2026-03-30

### Secondary (MEDIUM confidence)
- [libphonenumber-js npm](https://www.npmjs.com/package/libphonenumber-js) -- E.164 parsing API, size comparison
- [Total TypeScript TSConfig Cheat Sheet](https://www.totaltypescript.com/tsconfig-cheat-sheet) -- tsconfig recommendations for Node.js projects
- [BetterStack Pino Guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) -- Pino setup patterns, redaction examples

### Tertiary (LOW confidence)
- None -- all claims verified against primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified via npm registry, Express 5 stable since Oct 2024
- Architecture: HIGH -- layered Express pattern is industry standard, user decisions are clear
- Pitfalls: HIGH -- Express 5 migration guide documents all breaking changes, Pino redact docs are authoritative
- Env validation: HIGH -- Zod env pattern is well-documented with multiple authoritative sources

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable stack, no fast-moving dependencies)
