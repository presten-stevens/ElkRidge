import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

const mockCheckHealth = vi.fn();

vi.mock('../../services/health.js', () => ({
  checkHealth: (...args: unknown[]) => mockCheckHealth(...args),
}));

vi.mock('../../services/bluebubbles.js', () => ({
  getBBClient: vi.fn(() => ({ request: vi.fn() })),
}));

describe('GET /health', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns 200 with HealthResponse JSON when BB is healthy', async () => {
    mockCheckHealth.mockResolvedValue({
      status: 'healthy',
      bluebubbles: { status: 'connected', version: '1.9.9' },
      imessage: { authenticated: true },
      system: { macosVersion: '15.3.1' },
      timestamp: '2026-01-15T12:00:00.000Z',
      lastChecked: null,
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.status).toBe('healthy');
    expect(res.body.bluebubbles.version).toBe('1.9.9');
    expect(res.body.imessage.authenticated).toBe(true);
    expect(res.body.system.macosVersion).toBe('15.3.1');
    expect(res.body.timestamp).toBe('2026-01-15T12:00:00.000Z');
    expect(res.body.lastChecked).toBeNull();
  });

  it('returns 200 with status "down" when BB is unreachable (still reports, not failing)', async () => {
    mockCheckHealth.mockResolvedValue({
      status: 'down',
      bluebubbles: { status: 'unreachable', version: '' },
      imessage: { authenticated: false },
      system: { macosVersion: '' },
      timestamp: '2026-01-15T12:00:00.000Z',
      lastChecked: null,
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('down');
    expect(res.body.bluebubbles.status).toBe('unreachable');
  });

  it('returns 200 with status "degraded" when iMessage is not authenticated', async () => {
    mockCheckHealth.mockResolvedValue({
      status: 'degraded',
      bluebubbles: { status: 'connected', version: '1.9.9' },
      imessage: { authenticated: false },
      system: { macosVersion: '15.3.1' },
      timestamp: '2026-01-15T12:00:00.000Z',
      lastChecked: null,
    });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.imessage.authenticated).toBe(false);
  });

  it('response body matches D-01 shape exactly', async () => {
    mockCheckHealth.mockResolvedValue({
      status: 'healthy',
      bluebubbles: { status: 'connected', version: '1.9.9' },
      imessage: { authenticated: true },
      system: { macosVersion: '15.3.1' },
      timestamp: '2026-01-15T12:00:00.000Z',
      lastChecked: null,
    });

    const res = await request(app).get('/health');

    expect(Object.keys(res.body).sort()).toEqual(
      ['bluebubbles', 'imessage', 'lastChecked', 'status', 'system', 'timestamp'].sort(),
    );
    expect(Object.keys(res.body.bluebubbles).sort()).toEqual(['status', 'version'].sort());
    expect(Object.keys(res.body.imessage)).toEqual(['authenticated']);
    expect(Object.keys(res.body.system)).toEqual(['macosVersion']);
  });
});
