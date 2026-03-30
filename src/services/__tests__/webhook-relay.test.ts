import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BBSocketMessage } from '../../types/bluebubbles.js';

vi.mock('../../config/env.js', () => ({
  env: {
    CRM_WEBHOOK_URL: 'https://crm.example.com/webhook',
    RETRY_QUEUE_MAX_SIZE: 1000,
    LOG_LEVEL: 'info',
  },
}));

vi.mock('../../middleware/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockStart = vi.fn();
const mockDestroy = vi.fn();
const mockEnqueue = vi.fn();

vi.mock('../retry-queue.js', () => {
  const MockRetryQueue = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.start = mockStart;
    this.destroy = mockDestroy;
    this.enqueue = mockEnqueue;
    this.size = 0;
  });
  return { RetryQueue: MockRetryQueue };
});

import {
  relayToCRM,
  mapInboundMessage,
  mapDeliveryConfirmation,
  relayWithRetry,
  initRelay,
  shutdownRelay,
} from '../webhook-relay.js';
import { env } from '../../config/env.js';
import { logger } from '../../middleware/logger.js';
import { RetryQueue } from '../retry-queue.js';

function makeBBSocketMessage(overrides: Partial<BBSocketMessage> = {}): BBSocketMessage {
  return {
    guid: 'msg-guid-1',
    text: 'Hello world',
    isFromMe: false,
    dateCreated: 1700000000000,
    dateDelivered: 0,
    dateRead: 0,
    handle: { address: '+15551234567' },
    chats: [{ guid: 'iMessage;-;+15551234567' }],
    attachments: [],
    associatedMessageGuid: '',
    associatedMessageType: '',
    error: 0,
    ...overrides,
  };
}

describe('mapInboundMessage', () => {
  it('maps BBSocketMessage to InboundMessagePayload', () => {
    const msg = makeBBSocketMessage();
    const result = mapInboundMessage(msg);

    expect(result).toEqual({
      type: 'inbound_message',
      messageId: 'msg-guid-1',
      sender: '+15551234567',
      body: 'Hello world',
      timestamp: new Date(1700000000000).toISOString(),
      threadId: 'iMessage;-;+15551234567',
    });
  });

  it('uses handle.address for sender', () => {
    const msg = makeBBSocketMessage({ handle: { address: '+19995551234' } });
    expect(mapInboundMessage(msg).sender).toBe('+19995551234');
  });

  it('uses chats[0].guid for threadId', () => {
    const msg = makeBBSocketMessage({ chats: [{ guid: 'chat-abc' }] });
    expect(mapInboundMessage(msg).threadId).toBe('chat-abc');
  });

  it('falls back to Unknown sender when handle is null', () => {
    const msg = makeBBSocketMessage({ handle: null });
    expect(mapInboundMessage(msg).sender).toBe('Unknown');
  });

  it('falls back to empty string body when text is null', () => {
    const msg = makeBBSocketMessage({ text: null });
    expect(mapInboundMessage(msg).body).toBe('');
  });

  it('falls back to empty threadId when chats is empty', () => {
    const msg = makeBBSocketMessage({ chats: [] });
    expect(mapInboundMessage(msg).threadId).toBe('');
  });
});

describe('mapDeliveryConfirmation', () => {
  it('maps BBSocketMessage to DeliveryConfirmationPayload', () => {
    const msg = makeBBSocketMessage({ dateDelivered: 1700000001000 });
    const result = mapDeliveryConfirmation(msg);

    expect(result).toEqual({
      type: 'delivery_confirmation',
      messageId: 'msg-guid-1',
      status: 'delivered',
      timestamp: new Date(1700000001000).toISOString(),
    });
  });

  it('sets status to "read" if dateRead set', () => {
    const msg = makeBBSocketMessage({ dateRead: 1700000002000 });
    expect(mapDeliveryConfirmation(msg).status).toBe('read');
  });

  it('sets status to "delivered" if dateDelivered set', () => {
    const msg = makeBBSocketMessage({ dateDelivered: 1700000001000 });
    expect(mapDeliveryConfirmation(msg).status).toBe('delivered');
  });

  it('sets status to "unknown" if neither set', () => {
    const msg = makeBBSocketMessage({ dateDelivered: 0, dateRead: 0 });
    expect(mapDeliveryConfirmation(msg).status).toBe('unknown');
  });

  it('prefers "read" over "delivered" when both are set', () => {
    const msg = makeBBSocketMessage({ dateDelivered: 1700000001000, dateRead: 1700000002000 });
    expect(mapDeliveryConfirmation(msg).status).toBe('read');
  });
});

describe('relayToCRM', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true on successful 200 response', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const payload = mapInboundMessage(makeBBSocketMessage());
    const result = await relayToCRM(payload);

    expect(result).toBe(true);
  });

  it('posts InboundMessagePayload to CRM_WEBHOOK_URL with correct headers', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const payload = mapInboundMessage(makeBBSocketMessage());
    await relayToCRM(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://crm.example.com/webhook');
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(options.body as string);
    expect(body.type).toBe('inbound_message');
  });

  it('posts DeliveryConfirmationPayload to CRM_WEBHOOK_URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const payload = mapDeliveryConfirmation(makeBBSocketMessage({ dateDelivered: 1700000001000 }));
    await relayToCRM(payload);

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.type).toBe('delivery_confirmation');
  });

  it('returns true when CRM_WEBHOOK_URL is not configured (skip is not failure)', async () => {
    const mutableEnv = env as { CRM_WEBHOOK_URL: string | undefined };
    const original = mutableEnv.CRM_WEBHOOK_URL;
    mutableEnv.CRM_WEBHOOK_URL = undefined;

    const payload = mapInboundMessage(makeBBSocketMessage());
    const result = await relayToCRM(payload);

    expect(result).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('CRM_WEBHOOK_URL not configured, skipping webhook relay');
    expect(fetchMock).not.toHaveBeenCalled();

    mutableEnv.CRM_WEBHOOK_URL = original;
  });

  it('returns false on non-ok response (500)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const payload = mapInboundMessage(makeBBSocketMessage());
    const result = await relayToCRM(payload);

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('uses AbortSignal.timeout for request timeout', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const payload = mapInboundMessage(makeBBSocketMessage());
    await relayToCRM(payload);

    const options = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(options.signal).toBeDefined();
  });

  it('returns false on network failure (does not throw)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const payload = mapInboundMessage(makeBBSocketMessage());
    const result = await relayToCRM(payload);

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('relayWithRetry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockEnqueue.mockClear();
    mockStart.mockClear();
    mockDestroy.mockClear();
    (RetryQueue as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    shutdownRelay();
    vi.restoreAllMocks();
  });

  it('does not enqueue on successful delivery', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    initRelay();

    const payload = mapInboundMessage(makeBBSocketMessage());
    await relayWithRetry(payload);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('enqueues payload on failed delivery', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Error' });
    initRelay();

    const payload = mapInboundMessage(makeBBSocketMessage());
    await relayWithRetry(payload);

    expect(mockEnqueue).toHaveBeenCalledWith(payload);
  });

  it('does not enqueue when relay not initialized', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Error' });
    // Do not call initRelay()

    const payload = mapInboundMessage(makeBBSocketMessage());
    await relayWithRetry(payload);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('initRelay / shutdownRelay', () => {
  beforeEach(() => {
    mockStart.mockClear();
    mockDestroy.mockClear();
    (RetryQueue as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    shutdownRelay();
  });

  it('initRelay creates RetryQueue with correct params and starts it', () => {
    initRelay();

    expect(RetryQueue).toHaveBeenCalledWith(1000, 5, expect.any(Function));
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('shutdownRelay calls destroy on the retry queue', () => {
    initRelay();
    shutdownRelay();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
