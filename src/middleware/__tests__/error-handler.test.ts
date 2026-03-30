import { describe, it, expect, vi, beforeEach } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';
import { AppError } from '../../types/errors.js';
import type { Request, Response, NextFunction } from 'express';

describe('errorHandler credential safety (SECR-04)', () => {
  const FAKE_BB_PASSWORD = 'super-secret-bb-password-12345';
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonBody: unknown;

  beforeEach(() => {
    mockReq = { method: 'GET', url: '/test' } as Partial<Request>;
    jsonBody = null;
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn((body: unknown) => {
        jsonBody = body;
      }),
    } as unknown as Partial<Response>;
    mockNext = vi.fn();
  });

  it('response body does not contain BLUEBUBBLES_PASSWORD value', () => {
    const error = new Error('Something went wrong');
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    const responseStr = JSON.stringify(jsonBody);
    expect(responseStr).not.toContain(FAKE_BB_PASSWORD);
  });

  it('returns structured { error: { message, code, retryable } } JSON', () => {
    const error = new Error('Bad request');
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    expect(jsonBody).toHaveProperty('error');
    const errBody = (jsonBody as { error: Record<string, unknown> }).error;
    expect(errBody).toHaveProperty('message');
    expect(errBody).toHaveProperty('code');
    expect(errBody).toHaveProperty('retryable');
  });

  it('does not leak password even when error.message contains it', () => {
    const error = new Error(`Connection failed with password=${FAKE_BB_PASSWORD}`);
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    const responseStr = JSON.stringify(jsonBody);
    // 500 errors should return generic message, not the raw err.message
    expect(responseStr).not.toContain(FAKE_BB_PASSWORD);
  });
});

describe('errorHandler AppError handling', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonBody: unknown;
  let statusCode: number;

  beforeEach(() => {
    mockReq = { method: 'GET', url: '/test' } as Partial<Request>;
    jsonBody = null;
    statusCode = 0;
    mockRes = {
      status: vi.fn((code: number) => {
        statusCode = code;
        return mockRes;
      }),
      json: vi.fn((body: unknown) => {
        jsonBody = body;
      }),
    } as unknown as Partial<Response>;
    mockNext = vi.fn();
  });

  it('AppError VALIDATION_ERROR returns 400 with retryable false', () => {
    const error = new AppError('Invalid input', 'VALIDATION_ERROR', false, 400);
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    expect(statusCode).toBe(400);
    const errBody = (jsonBody as { error: Record<string, unknown> }).error;
    expect(errBody).toEqual({
      message: 'Invalid input',
      code: 'VALIDATION_ERROR',
      retryable: false,
    });
  });

  it('AppError BB_OFFLINE returns 503 with retryable true', () => {
    const error = new AppError('BlueBubbles server is unreachable', 'BB_OFFLINE', true, 503);
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    expect(statusCode).toBe(503);
    const errBody = (jsonBody as { error: Record<string, unknown> }).error;
    expect(errBody).toEqual({
      message: 'Internal server error',
      code: 'BB_OFFLINE',
      retryable: true,
    });
  });

  it('AppError RATE_LIMITED returns 429 with retryable true', () => {
    const error = new AppError('Rate limit exceeded', 'RATE_LIMITED', true, 429);
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    expect(statusCode).toBe(429);
    const errBody = (jsonBody as { error: Record<string, unknown> }).error;
    expect(errBody).toEqual({
      message: 'Rate limit exceeded',
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('non-AppError returns 500 with generic message and retryable false (SECR-04)', () => {
    const error = new Error('some internal detail');
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    expect(statusCode).toBe(500);
    const errBody = (jsonBody as { error: Record<string, unknown> }).error;
    expect(errBody).toEqual({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      retryable: false,
    });
  });
});
