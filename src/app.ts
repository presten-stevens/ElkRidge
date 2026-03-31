import express from 'express';
import helmet from 'helmet';
import { httpLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { authMiddleware } from './middleware/auth.js';
import { healthRouter } from './routes/health.js';
import { router } from './routes/index.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(express.json());
  app.use(httpLogger);

  // Health BEFORE auth -- public for monitoring
  app.use(healthRouter);

  // Auth gates all subsequent routes
  app.use(authMiddleware);

  // Protected routes
  app.use(router);

  app.use(errorHandler);

  return app;
}
