# BlueBubbles iMessage API

A production-ready REST API wrapper for [BlueBubbles](https://github.com/BlueBubblesApp/bluebubbles-app), enabling programmatic iMessage send and receive capabilities. Built by DAVID AI for Elk Ridge Investments to integrate iMessage into Tyler's CRM workflow. The API handles outbound messaging with rate limiting, inbound webhook relay with retry logic, conversation history retrieval, and proactive health monitoring with downtime alerting.

## Quick Start

**Prerequisites:**

- macOS (Apple hardware required for iMessage)
- Node.js 20+
- BlueBubbles Server installed and running with iMessage signed in

**Setup:**

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your BlueBubbles URL and password

# Start in development mode
npm run dev

# Verify
curl http://localhost:3000/health
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /send | Send an iMessage to a phone number |
| GET | /conversations | List conversation threads with last message and unread count |
| GET | /conversations/:id | Message history for a specific thread with pagination |
| GET | /health | Service health check (BlueBubbles, iPhone, iMessage status) |

All endpoints except `/health` require authentication via `Authorization: Bearer <API_KEY>` header.

See [docs/API.md](docs/API.md) for full endpoint reference with request/response formats, error codes, and curl examples.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/API.md](docs/API.md) | Complete API reference with examples |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | AWS EC2 Mac deployment walkthrough |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | Adding a new phone number (step-by-step checklist) |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Source code structure, architecture decisions, and ownership transfer |

## Tech Stack

- **Runtime:** Node.js 20, Express 5, TypeScript
- **Validation:** Zod (env config, request bodies, query params)
- **Logging:** pino (structured JSON)
- **Process Management:** PM2 (crash recovery, reboot survival)
- **Reverse Proxy:** nginx (HTTPS/SSL, rate limiting)
- **iMessage Bridge:** BlueBubbles Server (Private API)

## Project Structure

```
src/
  config/       Environment configuration (Zod-validated)
  middleware/   Auth, error handling, request logging
  routes/       Express route handlers
  services/     Business logic (BB client, webhooks, health, retry)
  types/        TypeScript types and error codes
deploy/         nginx config, PM2 startup script
docs/           Documentation
```

## Quick Setup with Claude

Copy and paste the following prompt into Claude Code to get the API wrapper running:

```
I need you to set up the BlueBubbles iMessage API wrapper in this repo. Here's what to do:

1. Run `npm install` to install dependencies
2. Create the environment file(s) from .env.example:
   - `cp .env.example .env.tyler_iphone`
   - Fill in these values (I'll provide them):
     - BLUEBUBBLES_URL (e.g. http://localhost:1235)
     - BLUEBUBBLES_PASSWORD (the BlueBubbles server password)
     - API_KEY (generate one with `openssl rand -hex 32`)
     - PORT (e.g. 3000)
     - NODE_ENV=production
     - CRM_WEBHOOK_URL (if applicable)
3. Run `npm run build` to compile TypeScript
4. Install PM2 globally if not installed: `npm install -g pm2`
5. Start with PM2: `pm2 start ecosystem.config.js`
6. Verify it's running: `pm2 status` and `curl http://localhost:3000/health`
7. Save PM2 process list: `pm2 save`

For a second instance (second phone number), repeat step 2 with a new env file
(e.g. .env.tyler_android) using a different PORT and BLUEBUBBLES_URL, uncomment
the second app entry in ecosystem.config.js, and restart PM2.

Refer to docs/DEPLOYMENT.md for full production setup including nginx and SSL.
Refer to docs/ONBOARDING.md for adding additional phone numbers.
Refer to docs/API.md for the full endpoint reference.
```

## License

Proprietary - Built by DAVID AI for Elk Ridge Investments
