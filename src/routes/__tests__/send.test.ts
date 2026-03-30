import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

// Mock the BB client module
const mockSendMessage = vi.fn().mockResolvedValue({ guid: 'mock-guid', text: 'test' });
vi.mock('../../services/bluebubbles.js', () => ({
  getBBClient: vi.fn(() => ({
    sendMessage: mockSendMessage,
  })),
}));

// Mock the rate limiter module
const mockConsume = vi.fn(() => true);
const mockGetJitterMs = vi.fn(() => 0); // No jitter in tests
vi.mock('../../services/rate-limiter.js', () => ({
  getRateLimiter: vi.fn(() => ({
    consume: mockConsume,
    getJitterMs: mockGetJitterMs,
    get remainingTokens() {
      return 99;
    },
  })),
}));

describe('POST /send', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConsume.mockReturnValue(true);
    mockSendMessage.mockResolvedValue({ guid: 'mock-guid', text: 'test' });
    app = createApp();
  });

  describe('success cases', () => {
    it('returns messageId and queued status for valid request', async () => {
      const res = await request(app)
        .post('/send')
        .send({ to: '+12135551234', message: 'Hello' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('messageId');
      expect(res.body.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(res.body.status).toBe('queued');
    });

    it('normalizes US phone number', async () => {
      const res = await request(app)
        .post('/send')
        .send({ to: '(213) 555-1234', message: 'Hello' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('queued');
    });

    it('success response has exactly messageId and status fields', async () => {
      const res = await request(app)
        .post('/send')
        .send({ to: '+12135551234', message: 'Hello' });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['messageId', 'status'].sort());
    });
  });

  describe('validation errors (SEND-02)', () => {
    it('returns VALIDATION_ERROR for missing message', async () => {
      const res = await request(app).post('/send').send({ to: '+12135551234' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.retryable).toBe(false);
    });

    it('returns VALIDATION_ERROR for empty body', async () => {
      const res = await request(app).post('/send').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns INVALID_PHONE for garbage phone number', async () => {
      const res = await request(app)
        .post('/send')
        .send({ to: 'not-a-phone', message: 'Hello' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PHONE');
      expect(res.body.error.retryable).toBe(false);
    });
  });

  describe('rate limiting (SETUP-06)', () => {
    it('returns RATE_LIMITED when bucket exhausted', async () => {
      mockConsume.mockReturnValueOnce(false);

      const res = await request(app)
        .post('/send')
        .send({ to: '+12135551234', message: 'Hello' });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.body.error.retryable).toBe(true);
    });
  });

  describe('BB offline (fire-and-forget behavior)', () => {
    it('returns 200 queued even when BB will fail asynchronously', async () => {
      // Since send is fire-and-forget, BB errors are logged but NOT propagated
      // to the HTTP response. The client gets "queued" regardless.
      mockSendMessage.mockRejectedValue(new Error('BB offline'));

      const res = await request(app)
        .post('/send')
        .send({ to: '+12135551234', message: 'Hello' });

      // Route returns immediately -- BB failure happens async
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('queued');
      expect(res.body).toHaveProperty('messageId');
    });
  });

  describe('error response shape', () => {
    it('response includes retryable field in validation error', async () => {
      const res = await request(app).post('/send').send({});

      expect(res.status).toBe(400);
      expect(typeof res.body.error.retryable).toBe('boolean');
    });

    it('response includes retryable field in rate limit error', async () => {
      mockConsume.mockReturnValueOnce(false);

      const res = await request(app)
        .post('/send')
        .send({ to: '+12135551234', message: 'Hello' });

      expect(res.status).toBe(429);
      expect(typeof res.body.error.retryable).toBe('boolean');
    });

    it('response includes retryable field in invalid phone error', async () => {
      const res = await request(app)
        .post('/send')
        .send({ to: 'not-a-phone', message: 'Hello' });

      expect(res.status).toBe(400);
      expect(typeof res.body.error.retryable).toBe('boolean');
    });
  });
});
