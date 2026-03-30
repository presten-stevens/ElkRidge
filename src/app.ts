import express from 'express';
import helmet from 'helmet';
import { httpLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { router } from './routes/index.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json());
  app.use(httpLogger);

  app.use(router);

  app.use(errorHandler);

  return app;
}
