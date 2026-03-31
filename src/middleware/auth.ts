import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';
import { logger } from './logger.js';

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!env.API_KEY) {
    logger.warn('API_KEY not set -- authentication disabled');
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new AppError('Invalid or missing API key', ERROR_CODES.AUTH_FAILURE, false, 401));
    return;
  }

  const token = authHeader.slice(7);

  if (token !== env.API_KEY) {
    next(new AppError('Invalid or missing API key', ERROR_CODES.AUTH_FAILURE, false, 401));
    return;
  }

  next();
}
