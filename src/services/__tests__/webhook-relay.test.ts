import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BBSocketMessage } from '../../types/bluebubbles.js';

vi.mock('../../config/env.js', () => ({
  env: {
    CRM_WEBHOOK_URL: 'https://crm.example.com/webhook',
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

import { relayToCRM, mapInboundMessage, mapDeliveryConfirmation } from '../webhook-relay.js';
import { env } from '../../config/env.js';
import { logger } from '../../middleware/logger.js';

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

  it('logs warning and returns when CRM_WEBHOOK_URL is not configured', async () => {
    const mutableEnv = env as { CRM_WEBHOOK_URL: string | undefined };
    const original = mutableEnv.CRM_WEBHOOK_URL;
    mutableEnv.CRM_WEBHOOK_URL = undefined;

    const payload = mapInboundMessage(makeBBSocketMessage());
    await relayToCRM(payload);

    expect(logger.warn).toHaveBeenCalledWith('CRM_WEBHOOK_URL not configured, skipping webhook relay');
    expect(fetchMock).not.toHaveBeenCalled();

    mutableEnv.CRM_WEBHOOK_URL = original;
  });

  it('logs error when fetch returns non-ok status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const payload = mapInboundMessage(makeBBSocketMessage());
    await relayToCRM(payload);

    expect(logger.error).toHaveBeenCalled();
    // Should NOT throw
  });

  it('uses AbortSignal.timeout for request timeout', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const payload = mapInboundMessage(makeBBSocketMessage());
    await relayToCRM(payload);

    const options = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(options.signal).toBeDefined();
  });

  it('logs error and returns on network failure (does not throw)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const payload = mapInboundMessage(makeBBSocketMessage());
    await expect(relayToCRM(payload)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});
