import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      '*.password',
      '*.bluebubbles_password',
      '*.BLUEBUBBLES_PASSWORD',
      'req.headers.authorization',
      'req.query.password',
    ],
    censor: '[REDACTED]',
  },
  transport: env.ENABLE_PRETTY_LOGS
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export const httpLogger = pinoHttp({ logger });
