import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlueBubblesClient } from '../bluebubbles.js';
import type { HealthResponse } from '../../types/health.js';

vi.mock('../../config/env.js', () => ({
  env: {
    HEALTH_POLL_INTERVAL_MS: 1000,
    ALERT_AFTER_FAILURES: 2,
    ALERT_WEBHOOK_URL: 'https://hooks.example.com/alert',
  },
}));

vi.mock('../../middleware/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../health.js', () => ({
  checkHealth: vi.fn(),
}));

function makeHealthResponse(status: 'healthy' | 'degraded' | 'down'): HealthResponse {
  return {
    status,
    bluebubbles: { status: status === 'down' ? 'unreachable' : 'connected', version: '1.9.9' },
    imessage: { authenticated: status === 'healthy' },
    system: { macosVersion: '15.3.1' },
    timestamp: new Date().toISOString(),
    lastChecked: null,
  };
}

const mockClient = { request: vi.fn() } as unknown as BlueBubblesClient;

describe('health-monitor', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let checkHealth: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const healthMod = await import('../health.js');
    checkHealth = vi.mocked(healthMod.checkHealth);
    checkHealth.mockResolvedValue(makeHealthResponse('healthy'));
  });

  afterEach(async () => {
    const { shutdownHealthMonitor } = await import('../health-monitor.js');
    shutdownHealthMonitor();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('polls health on interval', async () => {
    const { initHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);

    await vi.advanceTimersByTimeAsync(1000);
    expect(checkHealth).toHaveBeenCalledWith(mockClient);
  });

  it('alerts after consecutive failures with service=bluebubbles', async () => {
    checkHealth.mockResolvedValue(makeHealthResponse('down'));
    const { initHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe('https://hooks.example.com/alert');
    const body = JSON.parse(call[1].body);
    expect(body.type).toBe('downtime_alert');
    expect(body.service).toBe('bluebubbles');
    expect(body.status).toBe('down');
  });

  it('alerts for imessage degraded with service=imessage', async () => {
    checkHealth.mockResolvedValue(makeHealthResponse('degraded'));
    const { initHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.service).toBe('imessage');
  });

  it('does not re-alert after threshold (D-11)', async () => {
    checkHealth.mockResolvedValue(makeHealthResponse('down'));
    const { initHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-alerts after recovery then failure', async () => {
    checkHealth.mockResolvedValue(makeHealthResponse('down'));
    const { initHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);

    // 2 failures -> alert
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Recovery
    checkHealth.mockResolvedValue(makeHealthResponse('healthy'));
    await vi.advanceTimersByTimeAsync(1000);

    // 2 more failures -> alert again
    checkHealth.mockResolvedValue(makeHealthResponse('down'));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('resets failures on healthy (no alert if threshold not reached)', async () => {
    checkHealth.mockResolvedValue(makeHealthResponse('down'));
    const { initHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);

    // 1 failure
    await vi.advanceTimersByTimeAsync(1000);

    // Recovery
    checkHealth.mockResolvedValue(makeHealthResponse('healthy'));
    await vi.advanceTimersByTimeAsync(1000);

    // 1 failure again (never reaches threshold of 2)
    checkHealth.mockResolvedValue(makeHealthResponse('down'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips alert when ALERT_WEBHOOK_URL not configured', async () => {
    const envMod = await import('../../config/env.js');
    (envMod.env as Record<string, unknown>).ALERT_WEBHOOK_URL = undefined;

    checkHealth.mockResolvedValue(makeHealthResponse('down'));
    const { initHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockFetch).not.toHaveBeenCalled();

    // Restore
    (envMod.env as Record<string, unknown>).ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
  });

  it('logs error on alert POST failure without throwing', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    checkHealth.mockResolvedValue(makeHealthResponse('down'));
    const { initHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    // Should not throw -- fire and forget
    const { logger } = await import('../../middleware/logger.js');
    expect(logger.error).toHaveBeenCalled();
  });

  it('shutdown clears interval', async () => {
    const { initHealthMonitor, shutdownHealthMonitor } = await import('../health-monitor.js');
    initHealthMonitor(mockClient);
    shutdownHealthMonitor();

    checkHealth.mockClear();
    await vi.advanceTimersByTimeAsync(2000);

    expect(checkHealth).not.toHaveBeenCalled();
  });
});
