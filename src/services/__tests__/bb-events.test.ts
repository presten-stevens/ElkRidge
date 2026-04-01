import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BBSocketMessage } from '../../types/bluebubbles.js';

// ── Mocks ──────────────────────────────────────────────────────────────

type SocketHandler = (...args: unknown[]) => void;

const handlers = new Map<string, SocketHandler>();
const mockSocket = {
  on: vi.fn((event: string, handler: SocketHandler) => {
    handlers.set(event, handler);
    return mockSocket;
  }),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

vi.mock('../../config/env.js', () => ({
  env: {
    BLUEBUBBLES_URL: 'http://localhost:1234',
    BLUEBUBBLES_PASSWORD: 'test-password',
    LOG_LEVEL: 'info',
  },
}));

vi.mock('../../middleware/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockIsDuplicate = vi.fn().mockReturnValue(false);
const mockDestroy = vi.fn();
vi.mock('../dedup.js', () => {
  return {
    DedupBuffer: class MockDedupBuffer {
      isDuplicate = mockIsDuplicate;
      destroy = mockDestroy;
    },
  };
});

const mockMapInbound = vi.fn().mockReturnValue({ type: 'inbound_message', messageId: 'test' });
const mockMapDelivery = vi.fn().mockReturnValue({ type: 'delivery_confirmation', messageId: 'test' });
const mockRelayWithRetry = vi.fn().mockResolvedValue(undefined);
vi.mock('../webhook-relay.js', () => ({
  mapInboundMessage: (...args: unknown[]) => mockMapInbound(...args),
  mapDeliveryConfirmation: (...args: unknown[]) => mockMapDelivery(...args),
  relayWithRetry: (...args: unknown[]) => mockRelayWithRetry(...args),
}));

const mockWriteSyncState = vi.fn().mockResolvedValue(undefined);
vi.mock('../sync-state.js', () => ({
  writeSyncState: (...args: unknown[]) => mockWriteSyncState(...args),
}));

const mockRunBackfill = vi.fn().mockResolvedValue(undefined);
vi.mock('../backfill.js', () => ({
  runBackfill: (...args: unknown[]) => mockRunBackfill(...args),
}));

vi.mock('../bluebubbles.js', () => ({
  getBBClient: vi.fn().mockReturnValue({ getMessagesSince: vi.fn() }),
}));

import { io } from 'socket.io-client';
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

describe('bb-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
  });

  afterEach(async () => {
    // Clean up module state between tests
    const { shutdownBBEvents } = await import('../bb-events.js');
    shutdownBBEvents();
  });

  describe('initBBEvents', () => {
    it('creates Socket.IO connection with correct URL and auth', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      expect(io).toHaveBeenCalledWith('http://localhost:1234', expect.objectContaining({
        query: { password: 'test-password' },
        reconnection: true,
      }));
    });

    it('configures reconnection with exponential backoff', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      expect(io).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        reconnectionAttempts: Infinity,
      }));
    });

    it('registers listeners for connect, disconnect, connect_error, new-message, updated-message', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      expect(handlers.has('connect')).toBe(true);
      expect(handlers.has('disconnect')).toBe(true);
      expect(handlers.has('connect_error')).toBe(true);
      expect(handlers.has('new-message')).toBe(true);
      expect(handlers.has('updated-message')).toBe(true);
    });

    it('logs on connect event', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const connectHandler = handlers.get('connect')!;
      connectHandler();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Connected'));
    });

    it('logs warning on disconnect event', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const disconnectHandler = handlers.get('disconnect')!;
      disconnectHandler('io server disconnect');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('logs error on connect_error without error object (SECR-04)', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const errorHandler = handlers.get('connect_error')!;
      errorHandler(new Error('auth failed'));

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('connection error'));
    });
  });

  describe('new-message handler', () => {
    it('processes inbound message: dedup -> map -> relay -> sync', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const msg = makeBBSocketMessage();
      const handler = handlers.get('new-message')!;
      await handler(msg);

      expect(mockIsDuplicate).toHaveBeenCalledWith('msg-guid-1');
      expect(mockMapInbound).toHaveBeenCalledWith(msg);
      expect(mockRelayWithRetry).toHaveBeenCalled();
      expect(mockWriteSyncState).toHaveBeenCalledWith(new Date(1700000000000).toISOString());
    });

    it('skips processing when isFromMe is true (outbound filter)', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const msg = makeBBSocketMessage({ isFromMe: true });
      const handler = handlers.get('new-message')!;
      await handler(msg);

      expect(mockIsDuplicate).not.toHaveBeenCalled();
      expect(mockMapInbound).not.toHaveBeenCalled();
      expect(mockRelayWithRetry).not.toHaveBeenCalled();
    });

    it('skips relay when message is a duplicate', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();
      mockIsDuplicate.mockReturnValueOnce(true);

      const msg = makeBBSocketMessage();
      const handler = handlers.get('new-message')!;
      await handler(msg);

      expect(mockIsDuplicate).toHaveBeenCalledWith('msg-guid-1');
      expect(mockMapInbound).not.toHaveBeenCalled();
      expect(mockRelayWithRetry).not.toHaveBeenCalled();
    });

    it('does not crash on relay error (logs and continues)', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();
      mockRelayWithRetry.mockRejectedValueOnce(new Error('network fail'));

      const msg = makeBBSocketMessage();
      const handler = handlers.get('new-message')!;

      // Should not throw
      await expect(handler(msg)).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('updated-message handler', () => {
    it('processes delivery confirmation for our sent messages (isFromMe=true)', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const msg = makeBBSocketMessage({ isFromMe: true, dateDelivered: 1700000001000 });
      const handler = handlers.get('updated-message')!;
      await handler(msg);

      expect(mockIsDuplicate).toHaveBeenCalledWith('msg-guid-1');
      expect(mockMapDelivery).toHaveBeenCalledWith(msg);
      expect(mockRelayWithRetry).toHaveBeenCalled();
    });

    it('skips processing when isFromMe is false', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const msg = makeBBSocketMessage({ isFromMe: false });
      const handler = handlers.get('updated-message')!;
      await handler(msg);

      expect(mockMapDelivery).not.toHaveBeenCalled();
      expect(mockRelayWithRetry).not.toHaveBeenCalled();
    });

    it('skips duplicate updated-message events', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();
      mockIsDuplicate.mockReturnValueOnce(true);

      const msg = makeBBSocketMessage({ isFromMe: true });
      const handler = handlers.get('updated-message')!;
      await handler(msg);

      expect(mockMapDelivery).not.toHaveBeenCalled();
      expect(mockRelayWithRetry).not.toHaveBeenCalled();
    });

    it('does not crash on relay error (logs and continues)', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();
      mockRelayWithRetry.mockRejectedValueOnce(new Error('relay fail'));

      const msg = makeBBSocketMessage({ isFromMe: true, dateDelivered: 1700000001000 });
      const handler = handlers.get('updated-message')!;

      await expect(handler(msg)).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('reconnect backfill', () => {
    it('does NOT trigger backfill on first connect (startup)', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const connectHandler = handlers.get('connect')!;
      connectHandler();

      expect(mockRunBackfill).not.toHaveBeenCalled();
    });

    it('triggers backfill on reconnect (second connect event)', async () => {
      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const connectHandler = handlers.get('connect')!;
      connectHandler(); // first connect
      connectHandler(); // reconnect

      expect(mockRunBackfill).toHaveBeenCalledTimes(1);
    });

    it('backfill error does not crash (fire-and-forget)', async () => {
      mockRunBackfill.mockRejectedValueOnce(new Error('backfill fail'));

      const { initBBEvents } = await import('../bb-events.js');
      initBBEvents();

      const connectHandler = handlers.get('connect')!;
      connectHandler(); // first connect
      connectHandler(); // reconnect triggers backfill

      // Allow the promise rejection to be caught
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: 'backfill fail' }),
        'Reconnect backfill failed',
      );
    });
  });

  describe('getDedup', () => {
    it('returns null before initBBEvents', async () => {
      const { getDedup } = await import('../bb-events.js');
      expect(getDedup()).toBeNull();
    });

    it('returns DedupBuffer instance after initBBEvents', async () => {
      const { initBBEvents, getDedup } = await import('../bb-events.js');
      initBBEvents();
      expect(getDedup()).not.toBeNull();
    });
  });

  describe('shutdownBBEvents', () => {
    it('disconnects socket and destroys dedup buffer', async () => {
      const { initBBEvents, shutdownBBEvents } = await import('../bb-events.js');
      initBBEvents();
      shutdownBBEvents();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(mockDestroy).toHaveBeenCalled();
    });
  });
});
