import { describe, it, expect, vi, beforeEach } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';
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

  it('returns structured { error: { message, code } } JSON', () => {
    const error = new Error('Bad request');
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    expect(jsonBody).toHaveProperty('error');
    expect((jsonBody as { error: Record<string, unknown> }).error).toHaveProperty('message');
    expect((jsonBody as { error: Record<string, unknown> }).error).toHaveProperty('code');
  });

  it('does not leak password even when error.message contains it', () => {
    const error = new Error(`Connection failed with password=${FAKE_BB_PASSWORD}`);
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    const responseStr = JSON.stringify(jsonBody);
    // 500 errors should return generic message, not the raw err.message
    expect(responseStr).not.toContain(FAKE_BB_PASSWORD);
  });
});
