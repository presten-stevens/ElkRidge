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
});
