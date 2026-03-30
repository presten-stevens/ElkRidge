import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error({ err, req }, 'Unhandled error');

  const status = 'status' in err ? (err as any).status : 500;
  // Defense in depth: never expose raw error messages for 500+ errors (SECR-04)
  // Only expose err.message for client errors (4xx) where messages are intentionally set
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({
    error: {
      message,
      code: 'INTERNAL_ERROR',
    },
  });
}
