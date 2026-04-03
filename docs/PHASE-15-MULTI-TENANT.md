# Multi-Tenant Architecture

**Scope:** Large | **Depends on:** Core API (complete)

---

## What It Does

Adds a management API for controlling multiple phone number instances from one place. Instead of SSH-ing into the server and managing separate PM2 processes manually, you get API endpoints to list, start, stop, and monitor all your phone numbers.

## Why It Matters

Right now, each phone number runs as its own process with its own config file, port, and nginx block. For 2-3 numbers, that's fine. At 10+, it becomes a maintenance headache -- adding a new number means editing 3 config files and restarting services. This centralizes it.

## How It Works

A new management process runs alongside your existing worker processes. It uses PM2's programmatic API to orchestrate workers and a simple JSON config file to define instances.

**Instance config** -- One `instances.json` file defines all phone numbers:
```json
{
  "instances": [
    {
      "id": "tyler-iphone",
      "name": "Tyler's iPhone",
      "port": 3000,
      "bluebubbles_url": "http://localhost:1234",
      "bluebubbles_password": "env:BB_PASSWORD_TYLER",
      "api_key": "env:API_KEY_TYLER",
      "crm_webhook_url": "https://crm.example.com/webhook"
    }
  ]
}
```

Secrets reference environment variables (`env:VAR_NAME`) so credentials never live in the config file.

**Management API endpoints:**
- `GET /instances` -- List all instances with status (online/stopped/errored)
- `POST /instances/:id/start` -- Start an instance
- `POST /instances/:id/stop` -- Stop an instance
- `POST /instances/:id/restart` -- Restart an instance
- `GET /health` -- Aggregated health across all instances in one call

**Separate auth** -- The management API uses its own API key (`MANAGER_API_KEY`), independent from the per-instance worker keys.

## Architecture

```
    Management API (port 4000)
         │
         │  controls via PM2
         │
    ┌────┼────────────────┐
    │    │                │
  Worker 1    Worker 2    Worker N
  port 3000   port 3001   port 300N
  Tyler's #   Office #    Sales #
```

**Zero changes to existing workers.** Your current setup becomes the first entry in `instances.json`. The management layer wraps around it.

## Migration Path

1. Deploy the management API alongside existing processes
2. Create `instances.json` with your current phone number(s)
3. Everything keeps running -- the management API gives you visibility and control on top

## Scope

- 2 development phases (services/config first, then routes/management app)
- 4 tasks total
- New `src/manager/` directory (doesn't touch existing worker code)
- Nginx config for instances stays manual (no auto-generation -- too risky)
