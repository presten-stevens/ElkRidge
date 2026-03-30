# Technology Stack

**Project:** BlueBubbles iMessage API Wrapper
**Researched:** 2026-03-30
**Overall Confidence:** HIGH

## Recommended Stack

### Runtime & Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 24.x LTS (24.14.1) | Runtime | Active LTS through April 2028. Native TypeScript type-stripping (stable), `--env-file` support, npm v11 with 65% faster installs. New project — no reason to start on 22.x. | HIGH |
| Express | 5.x (5.2.1) | HTTP framework | v5 is stable, async error handling built-in (rejected promises caught by router), path-to-regexp v8 for ReDoS protection. Tyler's team can maintain it — Express is the most widely understood Node framework. | HIGH |
| npm | 11.x (bundled with Node 24) | Package manager | Ships with Node 24. No reason to add yarn/pnpm complexity for a focused API service. | HIGH |

### BlueBubbles Server

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| BlueBubbles Server | 1.9.9 | iMessage bridge | Latest release (May 2025). Handles send/receive, conversation history, webhooks, device status. We wrap it, not replace it. | HIGH |

**BlueBubbles API details:**
- REST API at `/api/v1/*` — auth via `password` query param (we abstract this behind our Bearer token auth)
- Webhooks: BB POSTs to our configured URL on new-message, read-receipt, typing events
- Private API: Requires SIP disabled. Not needed for POC scope (text send/receive works without it)
- Postman collection available: https://documenter.getpostman.com/view/765844/UV5RnfwM

### HTTP Client (for calling BlueBubbles API)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| axios | 1.x (latest 1.x) | HTTP client to BlueBubbles | Interceptors for retry logic and error normalization. Request/response transforms simplify BB API integration. 40M+ weekly downloads, Tyler's team will recognize it. Native `fetch` lacks interceptors; undici is faster but we're not making thousands of requests/sec. | HIGH |

### Validation & Schema

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| zod | 3.x (3.24.x) | Request validation | TypeScript-first, infers types from schemas. v3 is battle-tested with 40M weekly downloads. v4 exists but v3 is the ecosystem standard and has more community examples. Use for validating incoming API requests and BlueBubbles response shapes. | HIGH |

### Logging

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| pino | 9.x | Structured logging | 5-10x faster than Winston. JSON output by default — critical for production log aggregation. Low overhead matters when this runs 24/7 on a single Mac. | HIGH |
| pino-pretty | 13.x | Dev log formatting | Human-readable logs in development. Use via `NODE_ENV=development` conditional. | HIGH |

### Security Middleware

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| helmet | 8.x (8.1.0) | HTTP security headers | Sets 13 security headers (CSP, HSTS, X-Frame-Options). One line: `app.use(helmet())`. Express best-practice per official docs. | HIGH |
| express-rate-limit | 8.x (8.3.1) | Rate limiting | Prevents abuse of the API. In-memory store is fine (single instance per phone number, no need for Redis). | HIGH |
| cors | 2.x | CORS headers | Tyler's CRM will call this API from a different origin. Configurable per-instance. | MEDIUM |

### Environment & Configuration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js `--env-file` | Built-in (Node 20.6+) | Environment variables | Zero dependencies. Node 24 has stable support. No need for dotenv in a new project. Multi-instance config via separate `.env` files per instance. | HIGH |

**Do NOT use dotenv.** Node 24 has native `--env-file` support. One fewer dependency.

### Process Management

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| PM2 | 6.x (6.0.14) | Process management | Auto-restart on crash, startup on boot (`pm2 startup`), log rotation, process monitoring. Industry standard for Node production on bare metal/VMs. | HIGH |

**PM2 ecosystem config pattern for multi-instance:**

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'imessage-api-tyler-phone1',
      script: './src/index.js',
      node_args: '--env-file=.env.phone1',
      instances: 1,           // Single instance per phone — no cluster
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    // Add more entries for additional phone numbers
  ],
};
```

**Key PM2 commands:**
- `pm2 start ecosystem.config.cjs` — start all instances
- `pm2 startup` — configure auto-start on macOS reboot (uses launchd)
- `pm2 save` — persist current process list
- `pm2 logs imessage-api-tyler-phone1` — tail logs for specific instance
- `pm2 monit` — real-time monitoring dashboard

### Reverse Proxy & SSL

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| nginx | Latest via Homebrew | Reverse proxy, SSL termination | Proven, lightweight, handles HTTPS so Node doesn't have to. On macOS: `brew install nginx`, config at `/opt/homebrew/etc/nginx/`. | HIGH |
| certbot | Latest via Homebrew | SSL certificate management | Free Let's Encrypt certificates. `brew install certbot`. Renewal via `launchd` (cron deprecated on modern macOS). DNS validation option if Cloudflare is used. | HIGH |

**Nginx config pattern (per-instance):**

```nginx
# /opt/homebrew/etc/nginx/servers/imessage-api.conf
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (for BlueBubbles real-time events if needed)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**SSL cert renewal automation (macOS launchd, not cron):**
- Create a launchd plist for `certbot renew`
- Load with `launchctl load ~/Library/LaunchAgents/com.certbot.renew.plist`
- Certs renew every 60-90 days automatically

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js test runner | Built-in (Node 22+) | Unit/integration tests | Zero dependencies. `node --test`. Stable in Node 24. Covers the testing needs of a focused API wrapper without pulling in Jest/Vitest. | MEDIUM |

### Development Tools

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| TypeScript | 5.x | Type safety | Type inference from zod schemas, catches BB API shape mismatches at dev time. Tyler's team benefits from self-documenting types. Use `tsc --noEmit` for checking, Node 24 native type-stripping for execution. | HIGH |
| @types/express | Latest | Express type defs | Required for TypeScript + Express 5 | HIGH |
| nodemon | 3.x | Dev auto-restart | File-change auto-restart during development. PM2 handles production. | MEDIUM |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Framework | Express 5 | Fastify | Fastify is faster but Tyler's team needs to maintain this. Express has 10x the community resources and tutorials. Performance isn't the bottleneck — BlueBubbles is. |
| Framework | Express 5 | Hono | Too new for a handoff project. Less ecosystem support for middleware Tyler might need later. |
| HTTP Client | axios | Native fetch | No interceptors, no automatic retry middleware, no request/response transforms. Would need to build all of that manually. |
| HTTP Client | axios | undici | Raw performance isn't needed — we make single-digit requests/sec to BlueBubbles. Axios DX is better for this use case. |
| Logging | pino | Winston | Winston is 5-10x slower. JSON structured logging is pino's default; Winston requires transport config. |
| Validation | zod | joi | Joi lacks TypeScript inference. Zod gives you the schema AND the TypeScript type in one declaration. |
| Env vars | --env-file | dotenv | Unnecessary dependency when Node 24 handles it natively. |
| Process mgr | PM2 | systemd/launchd | PM2 provides Node-specific features (cluster mode, log rotation, monitoring) that raw launchd doesn't. Also cross-platform if Tyler ever moves off Mac. |
| Testing | Node test runner | Jest/Vitest | Zero dependency testing for a focused API. Jest is heavy; Vitest needs Vite. Node test runner is stable and sufficient. |
| DB | JSON file | SQLite | Project requirement: no database. Single `last_synced_at` timestamp doesn't justify SQLite. |

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| dotenv | Node 24 has native `--env-file`. Zero-dep is better. |
| Express 4 | v5 is stable with better async error handling. No reason for v4 on a new project. |
| node-fetch | ESM-only creates import headaches. Native fetch exists in Node 24. But we use axios anyway. |
| MongoDB/PostgreSQL/SQLite | Project explicitly requires no database. JSON file for last_synced_at only. |
| Socket.io | BlueBubbles webhooks POST to our server. We don't need bidirectional WebSocket to Tyler's CRM. Simple HTTP webhook relay. |
| Passport.js | Overkill. Single API key auth is a 10-line middleware, not a framework. |
| Docker | Runs on bare macOS (iMessage requires macOS). Docker adds a layer that blocks Messages.app access. |

## Installation

```bash
# Initialize project
npm init -y

# Core dependencies
npm install express@^5.2.1 axios@^1 zod@^3.24 pino@^9 helmet@^8.1.0 express-rate-limit@^8.3.1 cors@^2

# Dev dependencies
npm install -D typescript@^5 @types/express@^5 @types/cors@^2 @types/node@^24 pino-pretty@^13 nodemon@^3

# Global tools (on the Mac server)
npm install -g pm2@^6
brew install nginx certbot
```

## Project Structure (Recommended)

```
bluebubbles-api/
  src/
    index.ts              # Entry point, Express app setup
    config.ts             # Env var parsing with zod schema validation
    middleware/
      auth.ts             # Bearer token validation
      errorHandler.ts     # Global error handler
      requestLogger.ts    # Pino request logging
    routes/
      send.ts             # POST /send
      conversations.ts    # GET /conversations, GET /conversations/:id
      health.ts           # GET /health
      webhooks.ts         # Inbound webhook receiver from BlueBubbles
    services/
      bluebubbles.ts      # Axios client for BlueBubbles API
      webhookRelay.ts     # Outbound webhook to Tyler's CRM with retry
      healthMonitor.ts    # Periodic health checks + downtime alerts
      syncState.ts        # last_synced_at JSON file read/write
    types/
      index.ts            # Shared TypeScript types
  .env.example            # Template for instance config
  ecosystem.config.cjs    # PM2 multi-instance config
  tsconfig.json
  package.json
```

## Version Pinning Strategy

Pin major versions (`^` prefix) in package.json. Lock exact versions in package-lock.json (npm default). This gives security patches automatically while preventing breaking changes.

For BlueBubbles Server: Pin to 1.9.x. Monitor the GitHub releases page before upgrading — community project means updates may introduce breaking changes.

## Sources

- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — Node 24 LTS status confirmed
- [Express.js](https://expressjs.com/) — v5 stable
- [BlueBubbles Server Releases](https://github.com/BlueBubblesApp/bluebubbles-server/releases) — v1.9.9 confirmed via GitHub API
- [BlueBubbles REST API Docs](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks)
- [BlueBubbles Postman Collection](https://documenter.getpostman.com/view/765844/UV5RnfwM)
- [PM2 npm](https://www.npmjs.com/package/pm2) — v6.0.14
- [Helmet.js](https://helmetjs.github.io/) — v8.1.0
- [express-rate-limit npm](https://www.npmjs.com/package/express-rate-limit) — v8.3.1
- [Zod npm](https://www.npmjs.com/package/zod) — v3.24.x recommended over v4
- [Pino vs Winston](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/) — performance benchmarks
- [Certbot macOS](https://certbot.eff.org/instructions?ws=other&os=osx)
- [nginx Homebrew](https://formulae.brew.sh/formula/nginx)
- [Node.js --env-file](https://nodejs.org/en/learn/command-line/how-to-read-environment-variables-from-nodejs) — native .env support
