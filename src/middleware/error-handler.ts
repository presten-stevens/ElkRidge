import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../types/errors.js';
import { logger } from './logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error({ err, req }, 'Unhandled error');

  if (err instanceof AppError) {
    // AppError: use structured code, retryable, and statusCode
    // SECR-04: for 500+ errors, never expose raw message
    const message = err.statusCode >= 500 ? 'Internal server error' : err.message;
    res.status(err.statusCode).json({
      error: {
        message,
        code: err.code,
        retryable: err.retryable,
      },
    });
    return;
  }

  // Non-AppError: generic 500 with SECR-04 protection
  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      retryable: false,
    },
  });
}
