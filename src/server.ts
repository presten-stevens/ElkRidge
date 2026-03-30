// Config MUST be imported first -- it fails fast on invalid env
import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './middleware/logger.js';
import { initBBEvents, getDedup } from './services/bb-events.js';
import { initRelay } from './services/webhook-relay.js';
import { runBackfill } from './services/backfill.js';
import { getBBClient } from './services/bluebubbles.js';

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
  initRelay();
  initBBEvents();
  // Fire-and-forget startup backfill (per D-07, D-11)
  const startupDedup = getDedup();
  if (startupDedup) {
    runBackfill(getBBClient(), startupDedup).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Startup backfill failed'),
    );
  }
});
