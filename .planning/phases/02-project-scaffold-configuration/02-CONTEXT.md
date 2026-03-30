# Phase 2: Project Scaffold & Configuration - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Express 5 application skeleton with environment-driven configuration, structured logging, and credential redaction. This is the foundation every subsequent phase builds on. No endpoints are implemented here -- only the scaffold, config layer, shared utilities (E.164 normalization), and logging infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Language & Runtime
- **D-01:** TypeScript (compiled). Use `tsc` for builds. All source in `src/`, compiled output in `dist/`. This gives compile-time safety, self-documenting interfaces for request/response shapes, and clean handoff to Tyler's team.

### Project Structure
- **D-02:** Layered architecture with sibling directories: `src/routes/`, `src/services/`, `src/middleware/`, `src/config/`, `src/utils/`. Routes stay thin (HTTP parsing only), business logic lives in services, cross-cutting concerns (logging, redaction, auth) are middleware.

### Logging & Credential Redaction
- **D-03:** Pino as the structured logging library. Use `pino-http` for Express request/response logging middleware.
- **D-04:** Credential redaction via Pino's declarative `redact` configuration. Paths like `['*.password', 'req.headers.authorization', '*.bluebubbles_password']` are declared at logger initialization. BlueBubbles password is stripped before serialization, not after. This satisfies SECR-04.
- **D-05:** Use `pino-pretty` for human-readable dev output. JSON output in production (PM2-friendly).

### Config & Validation
- **D-06:** Zod schema in a single `src/config/env.ts` file validates `process.env` at startup. TypeScript types are inferred from the schema. App fails fast with clear error messages on missing/invalid env vars.
- **D-07:** Per-instance `.env` files for multi-instance support (e.g., `.env.tyler_iphone`, `.env.tyler_android`). PM2's `ecosystem.config.js` references the correct `.env` file per instance.
- **D-08:** Use `.transform()` for boolean env vars, NOT `z.coerce.boolean()` (which parses `"false"` as `true` due to truthy string coercion).
- **D-09:** Zod will also be reused for request body validation in later phases (single dependency for both env and API validation).

### Claude's Discretion
- Express 5 specific configuration (router setup, error handling middleware patterns)
- tsconfig.json settings (target, module resolution)
- Package manager choice (npm vs pnpm vs yarn)
- Test framework selection (if scaffolded in this phase)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` -- Core vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` -- Full v1 requirement list with IDs
- `.planning/research/SUMMARY.md` -- Research synthesis with key risks and patterns
- `.planning/research/PITFALLS.md` -- BlueBubbles-specific risks (credential leaks, webhook dedup, etc.)

### Phase Requirements
- `.planning/REQUIREMENTS.md` SETUP-04 -- Environment-driven configuration, multi-instance support
- `.planning/REQUIREMENTS.md` SETUP-05 -- E.164 phone number normalization
- `.planning/REQUIREMENTS.md` SECR-04 -- BlueBubbles password never in logs or API responses

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None -- greenfield project, no existing code.

### Established Patterns
- None yet -- this phase establishes the patterns all subsequent phases follow.

### Integration Points
- PM2 ecosystem.config.js will be the deployment entry point
- Express app export for potential testing

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches for Express 5 + TypeScript scaffolding.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 02-project-scaffold-configuration*
*Context gathered: 2026-03-30*
