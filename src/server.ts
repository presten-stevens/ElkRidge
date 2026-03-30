// Config MUST be imported first -- it fails fast on invalid env
import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './middleware/logger.js';

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
});
