import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlueBubblesClient } from '../bluebubbles.js';
import type { BBServerInfo } from '../../types/health.js';

function makeMockClient(response?: BBServerInfo, shouldThrow = false) {
  const request = vi.fn();
  if (shouldThrow) {
    request.mockRejectedValue(new Error('BlueBubbles server is unreachable'));
  } else if (response) {
    request.mockResolvedValue(response);
  }
  return { request } as unknown as BlueBubblesClient;
}

const healthyServerInfo: BBServerInfo = {
  os_version: '15.3.1',
  server_version: '1.9.9',
  private_api: true,
  helper_connected: true,
  detected_imessage: 'user@icloud.com',
};

describe('checkHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns status "healthy" when BB responds with detected_imessage set', async () => {
    const { checkHealth } = await import('../health.js');
    const client = makeMockClient(healthyServerInfo);

    const result = await checkHealth(client);

    expect(result.status).toBe('healthy');
    expect(result.imessage.authenticated).toBe(true);
  });

  it('returns status "degraded" when detected_imessage is null', async () => {
    const { checkHealth } = await import('../health.js');
    const client = makeMockClient({ ...healthyServerInfo, detected_imessage: null });

    const result = await checkHealth(client);

    expect(result.status).toBe('degraded');
    expect(result.imessage.authenticated).toBe(false);
  });

  it('returns status "degraded" when detected_imessage is empty string', async () => {
    const { checkHealth } = await import('../health.js');
    const client = makeMockClient({ ...healthyServerInfo, detected_imessage: '' });

    const result = await checkHealth(client);

    expect(result.status).toBe('degraded');
    expect(result.imessage.authenticated).toBe(false);
  });

  it('returns status "down" when BB client.request throws', async () => {
    const { checkHealth } = await import('../health.js');
    const client = makeMockClient(undefined, true);

    const result = await checkHealth(client);

    expect(result.status).toBe('down');
    expect(result.bluebubbles.status).toBe('unreachable');
    expect(result.bluebubbles.version).toBe('');
    expect(result.system.macosVersion).toBe('');
    expect(result.imessage.authenticated).toBe(false);
  });

  it('includes correct version fields from server info', async () => {
    const { checkHealth } = await import('../health.js');
    const client = makeMockClient(healthyServerInfo);

    const result = await checkHealth(client);

    expect(result.bluebubbles.version).toBe('1.9.9');
    expect(result.system.macosVersion).toBe('15.3.1');
  });

  it('includes ISO timestamp', async () => {
    const { checkHealth } = await import('../health.js');
    const client = makeMockClient(healthyServerInfo);

    const result = await checkHealth(client);

    expect(result.timestamp).toBe('2026-01-15T12:00:00.000Z');
  });

  it('includes lastChecked field as null', async () => {
    const { checkHealth } = await import('../health.js');
    const client = makeMockClient(healthyServerInfo);

    const result = await checkHealth(client);

    expect(result.lastChecked).toBeNull();
  });

  it('includes bluebubbles.status as "connected" when healthy', async () => {
    const { checkHealth } = await import('../health.js');
    const client = makeMockClient(healthyServerInfo);

    const result = await checkHealth(client);

    expect(result.bluebubbles.status).toBe('connected');
  });
});
