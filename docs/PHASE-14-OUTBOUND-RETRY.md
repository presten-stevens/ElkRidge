# Outbound Message Retry

**Scope:** Small | **Depends on:** Core API (complete)

---

## What It Does

When BlueBubbles is temporarily unreachable, outbound messages are queued and retried automatically instead of being silently dropped. Currently, if BB is down when you call POST /send, the message is lost.

## Why It Matters

BlueBubbles can go offline briefly -- macOS updates, iMessage re-authentication, network hiccups. If your CRM fires a send during that window, the message disappears with no error surfaced to the caller (POST /send returns "queued" before the actual send happens). This means a client text just never arrives and nobody knows.

After this change, those messages get queued locally and retried with backoff until BB comes back online.

## How It Works

The fire-and-forget send path currently catches errors and logs them. After this change:

- **BB offline (network error):** Message is queued for retry with exponential backoff (1s, 2s, 4s... up to 60s). Retries continue until BB responds or max attempts are exhausted.
- **BB application error (e.g., invalid recipient):** Still dropped immediately. These aren't transient -- retrying won't help.
- **Queue is bounded** (default 500 messages) to prevent unbounded growth during extended outages.
- **TTL expiry** -- Messages older than 1 hour are discarded rather than sent late. A text that arrives an hour late is worse than one that doesn't arrive.

## What Changes for You

Nothing in the API contract. POST /send still returns the same response. The difference is that messages sent during BB downtime will actually arrive once it comes back, instead of vanishing.

## Scope

- 1 development phase
- 2 tasks total
- 3 new config options: max queue size, max retry attempts, message TTL
