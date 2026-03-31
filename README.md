# BlueBubbles iMessage API

A production-ready REST API wrapper for [BlueBubbles](https://github.com/BlueBubblesApp/bluebubbles-app), enabling programmatic iMessage send and receive capabilities. Built for Elk Ridge Investments to integrate iMessage into Tyler's CRM workflow. The API handles outbound messaging with rate limiting, inbound webhook relay with retry logic, conversation history retrieval, and proactive health monitoring with downtime alerting.

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

## License

Proprietary - Elk Ridge Investments
