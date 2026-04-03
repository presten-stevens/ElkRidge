# Persistent Retry Queue

**Scope:** Small | **Depends on:** Core API (complete)

---

## What It Does

Makes the webhook retry queue survive process restarts. Currently, if your CRM is down and the API service restarts at the same time, any pending retries in the queue are lost. After this change, they're saved to disk and resume automatically.

## Why It Matters

This closes the one remaining gap in message delivery reliability. The backfill system already catches messages missed during downtime, but there's a small window where retries-in-progress can be dropped if the stars align (CRM down + service restart). This eliminates that window entirely.

## How It Works

The retry queue writes its state to a JSON file on disk using atomic writes (same pattern the sync state already uses). On startup, it reads the file and resumes processing where it left off.

- Writes are coalesced -- the queue only writes to disk once per processing cycle, not on every single enqueue. This keeps disk I/O minimal even during bursts.
- If the file is missing or corrupted on startup, the queue starts empty (no crash).
- All existing retry behavior (exponential backoff, max attempts, queue size limits) stays the same.

## What Changes for You

Nothing. This is an internal reliability improvement. Your CRM webhook integration works exactly the same -- it just gets more reliable during edge-case failure scenarios.

## Scope

- 1 development phase
- 2 tasks total
- No new dependencies -- uses Node.js built-in file system APIs
