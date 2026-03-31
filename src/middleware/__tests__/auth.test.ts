import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockEnv = vi.hoisted(() => ({ API_KEY: 'test-api-key-1234567890' as string | undefined }));
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>();
  return { env: mockEnv, envSchema: actual.envSchema };
});

vi.mock('../logger.js', () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  httpLogger: vi.fn(),
}));

import { authMiddleware } from '../auth.js';
import { AppError } from '../../types/errors.js';
import { envSchema } from '../../config/env.js';

describe('authMiddleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.API_KEY = 'test-api-key-1234567890';
    mockReq = { headers: {} } as Partial<Request>;
    mockRes = {} as Partial<Response>;
    mockNext = vi.fn();
  });

  it('calls next() with no error for valid Bearer token', () => {
    mockReq.headers = { authorization: 'Bearer test-api-key-1234567890' };
    authMiddleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalledWith();
  });

  it('calls next(AppError) with 401 and AUTH_FAILURE for missing Authorization header', () => {
    mockReq.headers = {};
    authMiddleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = mockNext.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_FAILURE');
  });

  it('calls next(AppError) with 401 and AUTH_FAILURE for wrong token', () => {
    mockReq.headers = { authorization: 'Bearer wrong-token-value' };
    authMiddleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = mockNext.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_FAILURE');
  });

  it('calls next(AppError) with 401 for malformed header (no Bearer prefix)', () => {
    mockReq.headers = { authorization: 'Basic some-credentials' };
    authMiddleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = mockNext.mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_FAILURE');
  });

  it('calls next() with no error and logs warning when env.API_KEY is falsy (dev mode)', () => {
    mockEnv.API_KEY = undefined;
    authMiddleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalledWith();
    expect(mockWarn).toHaveBeenCalledWith('API_KEY not set -- authentication disabled');
  });
});

describe('envSchema production API_KEY validation', () => {
  const validEnv = {
    BLUEBUBBLES_URL: 'http://localhost:1234',
    BLUEBUBBLES_PASSWORD: 'test-password',
    PORT: '3000',
    LOG_LEVEL: 'info',
    ENABLE_PRETTY_LOGS: 'false',
    DEFAULT_COUNTRY_CODE: 'US',
  };

  it('fails when NODE_ENV=production and no API_KEY', () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: 'production' });
    expect(result.success).toBe(false);
  });

  it('passes when NODE_ENV=development and no API_KEY', () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: 'development' });
    expect(result.success).toBe(true);
  });
});
