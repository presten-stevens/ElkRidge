import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { AppError } from '../../types/errors.js';
import { ERROR_CODES } from '../../types/error-codes.js';

// Mock data
const mockConversationsResponse = {
  data: [
    {
      id: 'chat-guid',
      contact: '+15551234567',
      lastMessage: 'hello',
      timestamp: '2024-01-01T00:00:00.000Z',
      unreadCount: 0,
    },
  ],
  pagination: { offset: 0, limit: 25, total: 1 },
};

const mockMessagesResponse = {
  data: [
    {
      id: 'msg-guid',
      sender: '+15551234567',
      body: 'hello',
      timestamp: '2024-01-01T00:00:00.000Z',
      isFromMe: false,
    },
  ],
  pagination: { offset: 0, limit: 25, total: 1 },
};

// Mock the BB client module
const mockGetConversations = vi.fn().mockResolvedValue(mockConversationsResponse);
const mockGetMessages = vi.fn().mockResolvedValue(mockMessagesResponse);
vi.mock('../../services/bluebubbles.js', () => ({
  getBBClient: vi.fn(() => ({
    sendMessage: vi.fn().mockResolvedValue({ guid: 'mock-guid', text: 'test' }),
    getConversations: mockGetConversations,
    getMessages: mockGetMessages,
  })),
}));

// Mock the rate limiter module (needed for app initialization)
vi.mock('../../services/rate-limiter.js', () => ({
  getRateLimiter: vi.fn(() => ({
    consume: vi.fn(() => true),
    getJitterMs: vi.fn(() => 0),
    get remainingTokens() {
      return 99;
    },
  })),
}));

describe('GET /conversations', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversations.mockResolvedValue(mockConversationsResponse);
    mockGetMessages.mockResolvedValue(mockMessagesResponse);
    app = createApp();
  });

  describe('conversations list', () => {
    it('returns 200 with data and pagination using defaults', async () => {
      const res = await request(app).get('/conversations');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.data).toEqual(mockConversationsResponse.data);
      expect(res.body.pagination).toEqual({ offset: 0, limit: 25, total: 1 });
    });

    it('calls client with default offset=0 limit=25', async () => {
      await request(app).get('/conversations');

      expect(mockGetConversations).toHaveBeenCalledWith(0, 25);
    });
  });

  describe('pagination', () => {
    it('passes custom offset and limit to client', async () => {
      await request(app).get('/conversations?offset=10&limit=50');

      expect(mockGetConversations).toHaveBeenCalledWith(10, 50);
    });

    it('clamps limit to 100 when exceeding max', async () => {
      await request(app).get('/conversations?limit=200');

      expect(mockGetConversations).toHaveBeenCalledWith(0, 100);
    });
  });

  describe('validation', () => {
    it('returns 400 VALIDATION_ERROR for negative offset', async () => {
      const res = await request(app).get('/conversations?offset=-1');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.retryable).toBe(false);
    });

    it('returns 400 VALIDATION_ERROR for limit=0', async () => {
      const res = await request(app).get('/conversations?limit=0');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.retryable).toBe(false);
    });

    it('returns 400 VALIDATION_ERROR for non-numeric limit', async () => {
      const res = await request(app).get('/conversations?limit=abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.retryable).toBe(false);
    });

    it('returns 400 VALIDATION_ERROR for non-numeric offset', async () => {
      const res = await request(app).get('/conversations?offset=abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.retryable).toBe(false);
    });
  });
});

describe('GET /conversations/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversations.mockResolvedValue(mockConversationsResponse);
    mockGetMessages.mockResolvedValue(mockMessagesResponse);
    app = createApp();
  });

  describe('message history', () => {
    it('returns 200 with message data and pagination', async () => {
      const res = await request(app).get('/conversations/chat-guid');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.data).toEqual(mockMessagesResponse.data);
      expect(res.body.pagination).toEqual({ offset: 0, limit: 25, total: 1 });
    });

    it('passes chatGuid to client', async () => {
      await request(app).get('/conversations/chat-guid');

      expect(mockGetMessages).toHaveBeenCalledWith('chat-guid', 0, 25);
    });
  });

  describe('pagination', () => {
    it('passes custom offset and limit to client', async () => {
      await request(app).get('/conversations/chat-guid?offset=5&limit=10');

      expect(mockGetMessages).toHaveBeenCalledWith('chat-guid', 5, 10);
    });

    it('clamps limit to 100 when exceeding max', async () => {
      await request(app).get('/conversations/chat-guid?limit=200');

      expect(mockGetMessages).toHaveBeenCalledWith('chat-guid', 0, 100);
    });
  });

  describe('validation', () => {
    it('returns 400 VALIDATION_ERROR for negative offset', async () => {
      const res = await request(app).get('/conversations/chat-guid?offset=-1');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.retryable).toBe(false);
    });

    it('returns 400 VALIDATION_ERROR for limit=0', async () => {
      const res = await request(app).get('/conversations/chat-guid?limit=0');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.retryable).toBe(false);
    });

    it('returns 400 VALIDATION_ERROR for non-numeric limit', async () => {
      const res = await request(app).get('/conversations/chat-guid?limit=abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.retryable).toBe(false);
    });
  });
});

describe('BB_OFFLINE', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('GET /conversations returns 503 BB_OFFLINE with retryable=true when BB offline', async () => {
    mockGetConversations.mockRejectedValue(
      new AppError('BlueBubbles server is unreachable', ERROR_CODES.BB_OFFLINE, true, 503),
    );

    const res = await request(app).get('/conversations');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BB_OFFLINE');
    expect(res.body.error.retryable).toBe(true);
  });

  it('GET /conversations/:id returns 503 BB_OFFLINE with retryable=true when BB offline', async () => {
    mockGetMessages.mockRejectedValue(
      new AppError('BlueBubbles server is unreachable', ERROR_CODES.BB_OFFLINE, true, 503),
    );

    const res = await request(app).get('/conversations/chat-guid');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BB_OFFLINE');
    expect(res.body.error.retryable).toBe(true);
  });
});
