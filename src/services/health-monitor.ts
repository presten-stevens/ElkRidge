import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';
import { checkHealth } from './health.js';
import type { BlueBubblesClient } from './bluebubbles.js';
import type { AlertPayload } from '../types/health.js';

let timer: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;
let alertFired = false;
let lastChecked: string | null = null;

export function initHealthMonitor(client: BlueBubblesClient): void {
  if (timer) {
    clearInterval(timer);
  }
  consecutiveFailures = 0;
  alertFired = false;

  timer = setInterval(() => {
    pollHealth(client).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Health poll error'),
    );
  }, env.HEALTH_POLL_INTERVAL_MS);
  timer.unref();
}

export function shutdownHealthMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  consecutiveFailures = 0;
  alertFired = false;
}

export function getLastChecked(): string | null {
  return lastChecked;
}

async function pollHealth(client: BlueBubblesClient): Promise<void> {
  const result = await checkHealth(client);

  if (result.status === 'healthy') {
    consecutiveFailures = 0;
    alertFired = false;
    lastChecked = new Date().toISOString();
    logger.debug({ status: result.status }, 'Health check passed');
    return;
  }

  // degraded or down
  consecutiveFailures++;
  if (result.status !== 'down') {
    lastChecked = new Date().toISOString();
  }

  logger.info(
    { status: result.status, consecutiveFailures },
    'Health check failure detected',
  );

  if (consecutiveFailures === env.ALERT_AFTER_FAILURES && !alertFired) {
    const service: 'bluebubbles' | 'imessage' =
      result.status === 'down' ? 'bluebubbles' : 'imessage';
    const payload: AlertPayload = {
      type: 'downtime_alert',
      service,
      status: result.status,
      message: `${service} is ${result.status} after ${consecutiveFailures} consecutive failures`,
      timestamp: new Date().toISOString(),
    };
    await sendAlert(payload);
    alertFired = true;
  }
}

async function sendAlert(payload: AlertPayload): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) {
    logger.warn('ALERT_WEBHOOK_URL not configured, skipping alert');
    return;
  }

  try {
    const res = await fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.error(
        { status: res.status, statusText: res.statusText },
        'Alert webhook delivery failed',
      );
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Alert webhook delivery failed (network error)',
    );
  }
}
