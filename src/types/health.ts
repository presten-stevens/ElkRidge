export interface BBServerInfo {
  os_version: string;
  server_version: string;
  private_api: boolean;
  helper_connected: boolean;
  detected_imessage: string | null;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'down';
  bluebubbles: { status: string; version: string };
  imessage: { authenticated: boolean };
  system: { macosVersion: string };
  timestamp: string;
  lastChecked: string | null;
}

export interface AlertPayload {
  type: 'downtime_alert';
  service: 'bluebubbles' | 'imessage';
  status: string;
  message: string;
  timestamp: string;
}
