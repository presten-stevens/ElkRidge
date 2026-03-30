import type { BlueBubblesClient } from './bluebubbles.js';
import type { BBServerInfo, HealthResponse } from '../types/health.js';

export async function checkHealth(client: BlueBubblesClient): Promise<HealthResponse> {
  try {
    const info = await client.request<BBServerInfo>('/api/v1/server/info');
    const authenticated = info.detected_imessage !== null && info.detected_imessage !== '';
    const status = authenticated ? 'healthy' : 'degraded';

    return {
      status,
      bluebubbles: { status: 'connected', version: info.server_version },
      imessage: { authenticated },
      system: { macosVersion: info.os_version },
      timestamp: new Date().toISOString(),
      lastChecked: null,
    };
  } catch {
    return {
      status: 'down',
      bluebubbles: { status: 'unreachable', version: '' },
      imessage: { authenticated: false },
      system: { macosVersion: '' },
      timestamp: new Date().toISOString(),
      lastChecked: null,
    };
  }
}
