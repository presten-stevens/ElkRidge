import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../middleware/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockReadSyncState = vi.fn();
const mockWriteSyncState = vi.fn().mockResolvedValue(undefined);
vi.mock('../sync-state.js', () => ({
  readSyncState: (...args: unknown[]) => mockReadSyncState(...args),
  writeSyncState: (...args: unknown[]) => mockWriteSyncState(...args),
}));

const mockRelayWithRetry = vi.fn().mockResolvedValue(undefined);
vi.mock('../webhook-relay.js', () => ({
  relayWithRetry: (...args: unknown[]) => mockRelayWithRetry(...args),
}));

import { logger } from '../../middleware/logger.js';
import type { BBMessage } from '../../types/bluebubbles.js';

function makeBBMessage(overrides: Partial<BBMessage> = {}): BBMessage {
  return {
    guid: 'msg-001',
    text: 'Hello from backfill',
    isFromMe: false,
    dateCreated: 1700000000000,
    handle: { address: '+15551234567' },
    ...overrides,
  };
}

function makeMockClient(pages: BBMessage[][]) {
  let callCount = 0;
  return {
    getMessagesSince: vi.fn().mockImplementation(() => {
      const page = pages[callCount] ?? [];
      callCount++;
      return Promise.resolve(page);
    }),
  };
}

function makeMockDedup(duplicateGuids: Set<string> = new Set()) {
  return {
    isDuplicate: vi.fn((guid: string) => duplicateGuids.has(guid)),
    destroy: vi.fn(),
  };
}

describe('runBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips backfill when readSyncState returns null', async () => {
    mockReadSyncState.mockResolvedValue(null);
    const client = makeMockClient([]);
    const dedup = makeMockDedup();

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('No last_synced_at'),
    );
    expect(client.getMessagesSince).not.toHaveBeenCalled();
  });

  it('converts ISO last_synced_at to epoch ms for getMessagesSince call', async () => {
    const isoDate = '2023-11-14T22:13:20.000Z';
    const expectedMs = new Date(isoDate).getTime();
    mockReadSyncState.mockResolvedValue(isoDate);
    const client = makeMockClient([[]]);
    const dedup = makeMockDedup();

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(client.getMessagesSince).toHaveBeenCalledWith(expectedMs, 0, 100);
  });

  it('processes inbound messages (isFromMe=false) through relay pipeline', async () => {
    mockReadSyncState.mockResolvedValue('2023-11-14T22:13:20.000Z');
    const msg = makeBBMessage({ guid: 'msg-inbound', isFromMe: false });
    const client = makeMockClient([[msg]]);
    const dedup = makeMockDedup();

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(mockRelayWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'inbound_message',
        messageId: 'msg-inbound',
        sender: '+15551234567',
        body: 'Hello from backfill',
      }),
    );
  });

  it('skips isFromMe messages', async () => {
    mockReadSyncState.mockResolvedValue('2023-11-14T22:13:20.000Z');
    const msg = makeBBMessage({ isFromMe: true });
    const client = makeMockClient([[msg]]);
    const dedup = makeMockDedup();

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(mockRelayWithRetry).not.toHaveBeenCalled();
  });

  it('skips duplicate messages (isDuplicate returns true)', async () => {
    mockReadSyncState.mockResolvedValue('2023-11-14T22:13:20.000Z');
    const msg = makeBBMessage({ guid: 'dup-guid' });
    const client = makeMockClient([[msg]]);
    const dedup = makeMockDedup(new Set(['dup-guid']));

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(mockRelayWithRetry).not.toHaveBeenCalled();
  });

  it('updates writeSyncState with each processed message timestamp', async () => {
    mockReadSyncState.mockResolvedValue('2023-11-14T22:13:20.000Z');
    const msg1 = makeBBMessage({ guid: 'msg-1', dateCreated: 1700000001000 });
    const msg2 = makeBBMessage({ guid: 'msg-2', dateCreated: 1700000002000 });
    const client = makeMockClient([[msg1, msg2]]);
    const dedup = makeMockDedup();

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(mockWriteSyncState).toHaveBeenCalledTimes(2);
    expect(mockWriteSyncState).toHaveBeenCalledWith(
      new Date(1700000001000).toISOString(),
    );
    expect(mockWriteSyncState).toHaveBeenCalledWith(
      new Date(1700000002000).toISOString(),
    );
  });

  it('paginates through multiple pages', async () => {
    mockReadSyncState.mockResolvedValue('2023-11-14T22:13:20.000Z');
    // First page: exactly 100 messages (triggers next page fetch)
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeBBMessage({ guid: `msg-${i}`, dateCreated: 1700000000000 + i }),
    );
    // Second page: fewer than 100 messages (pagination stops)
    const page2 = [makeBBMessage({ guid: 'msg-final', dateCreated: 1700000100000 })];
    const client = makeMockClient([page1, page2]);
    const dedup = makeMockDedup();

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(client.getMessagesSince).toHaveBeenCalledTimes(2);
    expect(client.getMessagesSince).toHaveBeenCalledWith(expect.any(Number), 0, 100);
    expect(client.getMessagesSince).toHaveBeenCalledWith(expect.any(Number), 100, 100);
    // 100 + 1 = 101 messages relayed
    expect(mockRelayWithRetry).toHaveBeenCalledTimes(101);
  });

  it('stops pagination when empty page returned', async () => {
    mockReadSyncState.mockResolvedValue('2023-11-14T22:13:20.000Z');
    const client = makeMockClient([[]]);
    const dedup = makeMockDedup();

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(client.getMessagesSince).toHaveBeenCalledTimes(1);
    expect(mockRelayWithRetry).not.toHaveBeenCalled();
  });

  it('logs backfill complete with count', async () => {
    mockReadSyncState.mockResolvedValue('2023-11-14T22:13:20.000Z');
    const msg1 = makeBBMessage({ guid: 'msg-1' });
    const msg2 = makeBBMessage({ guid: 'msg-2' });
    const client = makeMockClient([[msg1, msg2]]);
    const dedup = makeMockDedup();

    const { runBackfill } = await import('../backfill.js');
    await runBackfill(client as never, dedup as never);

    expect(logger.info).toHaveBeenCalledWith(
      { count: 2 },
      'Backfill complete',
    );
  });
});
