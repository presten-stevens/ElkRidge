import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlueBubblesClient } from '../bluebubbles.js';
import { AppError } from '../../types/errors.js';

describe('BlueBubblesClient', () => {
  const TEST_PASSWORD = 'test-password';
  let client: BlueBubblesClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new BlueBubblesClient('http://localhost:1234', TEST_PASSWORD);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sendMessage calls BB API with correct chat GUID format', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 200, data: { guid: 'test-guid', text: 'hello' } }),
    });

    await client.sendMessage('+12135551234', 'hello');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/message/text');
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.chatGuid).toBe('any;-;+12135551234');
  });

  it('sendMessage returns guid from BB response', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 200, data: { guid: 'test-guid', text: 'hello' } }),
    });

    const result = await client.sendMessage('+12135551234', 'hello');
    expect(result.guid).toBe('test-guid');
  });

  it('throws BB_OFFLINE when fetch fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client.sendMessage('+12135551234', 'hello')).rejects.toThrow(AppError);
    await expect(client.sendMessage('+12135551234', 'hello')).rejects.toMatchObject({
      code: 'BB_OFFLINE',
      retryable: true,
    });
  });

  it('throws SEND_FAILED when BB returns error status', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 400, error: { message: 'Bad request' } }),
    });

    await expect(client.sendMessage('+12135551234', 'hello')).rejects.toThrow(AppError);
    await expect(client.sendMessage('+12135551234', 'hello')).rejects.toMatchObject({
      code: 'SEND_FAILED',
      retryable: false,
    });
  });

  it('does not leak password in error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    try {
      await client.sendMessage('+12135551234', 'hello');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).not.toContain(TEST_PASSWORD);
    }
  });

  describe('requestWithMeta', () => {
    it('returns data and metadata from BB response', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [{ guid: 'chat-1' }],
          metadata: { count: 1, total: 50, offset: 0, limit: 25 },
        }),
      });

      const result = await client.requestWithMeta<{ guid: string }[]>('/api/v1/chat/query');
      expect(result.data).toEqual([{ guid: 'chat-1' }]);
      expect(result.metadata).toEqual({ count: 1, total: 50, offset: 0, limit: 25 });
    });

    it('throws BB_OFFLINE when fetch fails', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(client.requestWithMeta('/api/v1/chat/query')).rejects.toMatchObject({
        code: 'BB_OFFLINE',
        retryable: true,
      });
    });

    it('throws SEND_FAILED when BB returns non-200 status', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ status: 400, error: { message: 'Bad request' } }),
      });

      await expect(client.requestWithMeta('/api/v1/chat/query')).rejects.toMatchObject({
        code: 'SEND_FAILED',
        retryable: false,
      });
    });
  });

  describe('getConversations', () => {
    it('calls correct BB endpoint with POST and with: ["lastMessage"]', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [],
          metadata: { count: 0, total: 0, offset: 0, limit: 25 },
        }),
      });

      await client.getConversations(0, 25);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/v1/chat/query');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body).toEqual({ offset: 0, limit: 25, with: ['lastMessage'] });
    });

    it('maps BBChat to Conversation correctly', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [
            {
              guid: 'iMessage;-;+15551234567',
              chatIdentifier: '+15551234567',
              displayName: null,
              participants: [{ address: '+15551234567' }],
              lastMessage: {
                guid: 'msg-1',
                text: 'Hello there',
                isFromMe: false,
                dateCreated: 1700000000000,
                handle: { address: '+15551234567' },
              },
            },
          ],
          metadata: { count: 1, total: 1, offset: 0, limit: 25 },
        }),
      });

      const result = await client.getConversations(0, 25);
      expect(result.data).toEqual([
        {
          id: 'iMessage;-;+15551234567',
          contact: '+15551234567',
          lastMessage: 'Hello there',
          timestamp: new Date(1700000000000).toISOString(),
          unreadCount: 0,
        },
      ]);
    });

    it('returns pagination metadata', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [],
          metadata: { count: 0, total: 100, offset: 25, limit: 25 },
        }),
      });

      const result = await client.getConversations(25, 25);
      expect(result.pagination).toEqual({ offset: 25, limit: 25, total: 100 });
    });

    it('handles missing lastMessage with empty string', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [
            {
              guid: 'chat-1',
              chatIdentifier: '+15551234567',
              displayName: null,
              participants: [{ address: '+15551234567' }],
            },
          ],
          metadata: { count: 1, total: 1, offset: 0, limit: 25 },
        }),
      });

      const result = await client.getConversations(0, 25);
      expect(result.data[0]!.lastMessage).toBe('');
      expect(result.data[0]!.timestamp).toBe('');
    });

    it('falls back to participant address when chatIdentifier is missing', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [
            {
              guid: 'chat-2',
              chatIdentifier: null,
              displayName: null,
              participants: [{ address: '+15559876543' }],
            },
          ],
          metadata: { count: 1, total: 1, offset: 0, limit: 25 },
        }),
      });

      const result = await client.getConversations(0, 25);
      expect(result.data[0]!.contact).toBe('+15559876543');
    });
  });

  describe('getMessages', () => {
    it('calls correct BB endpoint with encoded chatGuid', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [],
          metadata: { count: 0, total: 0, offset: 0, limit: 25 },
        }),
      });

      await client.getMessages('iMessage;-;+15551234567', 0, 25);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain(`/api/v1/chat/${encodeURIComponent('iMessage;-;+15551234567')}/message`);
      expect(url).toContain('offset=0');
      expect(url).toContain('limit=25');
      expect(url).toContain('sort=DESC');
    });

    it('maps BBMessage to Message correctly', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [
            {
              guid: 'msg-1',
              text: 'Hello',
              isFromMe: false,
              dateCreated: 1700000000000,
              handle: { address: '+15551234567' },
            },
          ],
          metadata: { count: 1, total: 1, offset: 0, limit: 25 },
        }),
      });

      const result = await client.getMessages('chat-1', 0, 25);
      expect(result.data).toEqual([
        {
          id: 'msg-1',
          sender: '+15551234567',
          body: 'Hello',
          timestamp: new Date(1700000000000).toISOString(),
          isFromMe: false,
        },
      ]);
    });

    it('handles null text with empty string body', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [
            {
              guid: 'msg-2',
              text: null,
              isFromMe: false,
              dateCreated: 1700000000000,
              handle: { address: '+15551234567' },
            },
          ],
          metadata: { count: 1, total: 1, offset: 0, limit: 25 },
        }),
      });

      const result = await client.getMessages('chat-1', 0, 25);
      expect(result.data[0]!.body).toBe('');
    });

    it('handles null handle with isFromMe=true as "me" sender', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [
            {
              guid: 'msg-3',
              text: 'Sent by me',
              isFromMe: true,
              dateCreated: 1700000000000,
              handle: null,
            },
          ],
          metadata: { count: 1, total: 1, offset: 0, limit: 25 },
        }),
      });

      const result = await client.getMessages('chat-1', 0, 25);
      expect(result.data[0]!.sender).toBe('me');
    });

    it('handles null handle with isFromMe=false as "Unknown" sender', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [
            {
              guid: 'msg-4',
              text: 'Mystery',
              isFromMe: false,
              dateCreated: 1700000000000,
              handle: null,
            },
          ],
          metadata: { count: 1, total: 1, offset: 0, limit: 25 },
        }),
      });

      const result = await client.getMessages('chat-1', 0, 25);
      expect(result.data[0]!.sender).toBe('Unknown');
    });

    it('returns pagination metadata', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({
          status: 200,
          data: [],
          metadata: { count: 0, total: 200, offset: 50, limit: 25 },
        }),
      });

      const result = await client.getMessages('chat-1', 50, 25);
      expect(result.pagination).toEqual({ offset: 50, limit: 25, total: 200 });
    });
  });
});
