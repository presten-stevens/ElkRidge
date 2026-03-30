# Domain Pitfalls

**Domain:** iMessage API wrapper over BlueBubbles
**Researched:** 2026-03-30

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: BlueBubbles Server Updates Breaking the API
**What goes wrong:** Apple releases a macOS update, BlueBubbles pushes a server update to fix compatibility, and the API contract changes (endpoint paths, response shapes, webhook event formats).
**Why it happens:** BlueBubbles is community-maintained. No SLA, no versioned API guarantees, no deprecation warnings.
**Consequences:** Our wrapper returns garbage data or 500s after a BB update. Tyler's CRM integration breaks silently.
**Prevention:**
- Pin BlueBubbles Server to v1.9.9. Do not auto-update.
- Validate all BB responses with zod schemas — if the shape changes, we get a parse error instead of passing bad data through.
- Monitor the [BlueBubbles GitHub releases](https://github.com/BlueBubblesApp/bluebubbles-server/releases) before upgrading.
- Test BB updates in a non-production instance before rolling to Tyler's live phone.
**Detection:** Zod parse failures in logs, health endpoint returning degraded status, webhook relay errors.

### Pitfall 2: iMessage Sign-Out / Apple ID Session Expiry
**What goes wrong:** Apple periodically requires re-authentication of iMessage. The Mac's Messages.app signs out silently. BlueBubbles can't send or receive.
**Why it happens:** Apple security policy. Two-factor auth prompts, password changes, Apple ID lockouts, or macOS updates can all trigger sign-out.
**Consequences:** Messages fail silently — BB may return success but the message never sends. Inbound messages stop arriving.
**Prevention:**
- Health endpoint must check BB's connection status, not just whether Express is running.
- Downtime alerting fires to Tyler's alert URL within the configured threshold (default 5 minutes).
- Document the re-authentication procedure in the onboarding guide.
**Detection:** Health endpoint returns `{ iMessageConnected: false }`, alert fires to Tyler.

### Pitfall 3: Lost Messages During Service Downtime
**What goes wrong:** Our Express service goes down (crash, restart, deployment). BlueBubbles receives messages but can't deliver webhooks to us. Messages are lost.
**Why it happens:** BlueBubbles webhooks are fire-and-forget. If our service is down when BB tries to POST, the event is lost.
**Consequences:** Tyler's CRM never receives some inbound messages. Customer conversations have gaps.
**Prevention:**
- Store `last_synced_at` timestamp in JSON file on every successful webhook relay.
- On service startup, query BB for all messages since `last_synced_at` and relay them to Tyler's webhook.
- This is the backfill-on-reconnect feature — it's not optional, it's critical.
**Detection:** Gap detection in Tyler's CRM (missing messages between timestamps). Health endpoint showing recent restart.

### Pitfall 4: BlueBubbles Query Param Auth Leaking into Logs
**What goes wrong:** The BB password is passed as a URL query parameter (`?password=xxx`). Logging the full URL (which many HTTP clients do by default) exposes the password in log files.
**Why it happens:** BB's auth design uses query params instead of headers. Axios logs include the full URL by default.
**Consequences:** BB password exposed in log files, PM2 logs, error reports.
**Prevention:**
- Configure axios interceptors to strip the `password` param from logged URLs.
- Never log raw BB request/response objects — always sanitize first.
- Use pino's redact option to mask sensitive fields.
**Detection:** Grep logs for the BB password string. If found, rotate it.

## Moderate Pitfalls

### Pitfall 5: macOS Sleep / Power Management on EC2 Mac
**What goes wrong:** macOS power management puts the machine to sleep or suspends background processes.
**Prevention:**
- Disable sleep: `sudo pmset -a disablesleep 1`
- Prevent display sleep from affecting processes: `sudo pmset -a displaysleep 0`
- EC2 Mac instances need caffeinate or pmset configuration in the deployment guide.

### Pitfall 6: Webhook Retry Queue Growing Unbounded
**What goes wrong:** Tyler's CRM is down for hours. Retry queue grows in memory until the Express process runs out of memory and crashes.
**Prevention:**
- Cap the retry queue at a configurable max (e.g., 1000 events).
- Oldest events get dropped when the cap is reached — log a warning.
- Set `max_memory_restart: '512M'` in PM2 config as a safety net.
- On restart, backfill catches the gap anyway.

### Pitfall 7: BlueBubbles Chat GUID Format Assumptions
**What goes wrong:** Assuming all chat GUIDs follow `iMessage;-;+1234567890` format. SMS messages use `SMS;-;+1234567890`. Group chats use a different format entirely.
**Prevention:**
- Don't construct chat GUIDs manually when possible — use BB's chat lookup endpoints.
- For sending, try iMessage format first. If BB returns an error, document the fallback behavior.
- For POC: explicitly reject group chat GUIDs (return 400 with clear error message).

### Pitfall 8: Express 5 Breaking Changes from Express 4 Patterns
**What goes wrong:** Copying Express 4 patterns from tutorials/Stack Overflow into an Express 5 project. `app.del()` removed, `req.host` returns full host, path-to-regexp syntax changed.
**Prevention:**
- Use Express 5 documentation only — not Express 4 tutorials.
- Key differences: `app.delete()` not `app.del()`, async error handling is automatic, `req.query` is a plain object.
- Test routes with regex patterns — path-to-regexp v8 is more restrictive.

### Pitfall 9: SSL Certificate Renewal Failure on macOS
**What goes wrong:** Certbot renewal cron job doesn't run because macOS uses launchd, not cron. Certificate expires. HTTPS breaks.
**Prevention:**
- Use launchd (LaunchAgent plist), not crontab, for certbot renewal.
- Set up a monitoring check for cert expiry date.
- Document the launchd plist setup in the deployment guide.

## Minor Pitfalls

### Pitfall 10: PM2 Startup Script Not Persisting After macOS Update
**What goes wrong:** macOS update resets launchd configuration. PM2 doesn't start on boot.
**Prevention:** Document the `pm2 startup` + `pm2 save` procedure. Include it in the post-macOS-update checklist.

### Pitfall 11: Node.js --env-file Doesn't Support Variable Expansion
**What goes wrong:** Using `${VAR}` syntax in `.env` files expecting variable expansion. Node's native `--env-file` doesn't support it (dotenv does).
**Prevention:** Keep env vars self-contained. No variable references within the `.env` file.

### Pitfall 12: Timezone Issues in Message Timestamps
**What goes wrong:** BlueBubbles returns timestamps in one timezone, our service runs in another, Tyler's CRM expects UTC.
**Prevention:** Normalize all timestamps to ISO 8601 UTC in our response schemas. Never pass through raw BB timestamps without normalization.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Express scaffold | Express 5 vs 4 pattern confusion | Use v5 docs only, test async error handling early |
| BlueBubbles client | BB password in logs | Axios interceptor to redact query params from first line of code |
| POST /send | Chat GUID format assumptions | Use BB chat lookup, handle iMessage vs SMS formats |
| Webhook relay | Unbounded retry queue | Cap + max memory restart from day one |
| Backfill | Missing messages if last_synced_at not written atomically | Write temp file, rename (atomic on POSIX) |
| Health monitoring | Only checking Express, not BB | Health endpoint must call BB's `/api/v1/server/info` |
| Nginx + SSL | Cert renewal with cron | Use launchd, document in deployment guide |
| PM2 setup | Cluster mode temptation | Document why instances: 1 is correct |
| EC2 Mac deployment | macOS sleep | pmset configuration in deployment guide |
| Multi-instance | Port conflicts | Each instance gets unique PORT in its .env file |

## Sources

- [BlueBubbles Server Releases](https://github.com/BlueBubblesApp/bluebubbles-server/releases) — community maintenance patterns
- [BlueBubbles FAQ](https://bluebubbles.app/faq/) — known issues and limitations
- [Express 5 Migration](https://expressjs.com/) — breaking changes from v4
- [Certbot macOS Instructions](https://certbot.eff.org/instructions?ws=other&os=osx) — launchd vs cron
- [Certbot macOS Renewal Automation](https://automatica.com.au/2025/02/automate-letsencrypt-certbot-ssl-certificate-renewal-on-macos/) — launchd setup guide
- [PM2 Quick Start](https://pm2.keymetrics.io/docs/usage/quick-start/) — startup and process management
