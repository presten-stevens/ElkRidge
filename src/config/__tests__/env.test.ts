import { describe, it, expect } from 'vitest';
import { envSchema } from '../../config/env.js';

describe('envSchema', () => {
  const validEnv = {
    BLUEBUBBLES_URL: 'http://localhost:1234',
    BLUEBUBBLES_PASSWORD: 'test-password',
    PORT: '3000',
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    ENABLE_PRETTY_LOGS: 'false',
    DEFAULT_COUNTRY_CODE: 'US',
  };

  it('parses valid env vars with correct types', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
      expect(typeof result.data.PORT).toBe('number');
      expect(result.data.ENABLE_PRETTY_LOGS).toBe(false);
      expect(typeof result.data.ENABLE_PRETTY_LOGS).toBe('boolean');
    }
  });

  it('fails when BLUEBUBBLES_URL is missing', () => {
    const { BLUEBUBBLES_URL, ...withoutUrl } = validEnv;
    const result = envSchema.safeParse(withoutUrl);
    expect(result.success).toBe(false);
  });

  it('ENABLE_PRETTY_LOGS="false" produces boolean false (D-08)', () => {
    const result = envSchema.safeParse({ ...validEnv, ENABLE_PRETTY_LOGS: 'false' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ENABLE_PRETTY_LOGS).toBe(false);
    }
  });

  it('ENABLE_PRETTY_LOGS="true" produces boolean true', () => {
    const result = envSchema.safeParse({ ...validEnv, ENABLE_PRETTY_LOGS: 'true' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ENABLE_PRETTY_LOGS).toBe(true);
    }
  });

  it('PORT defaults to 3000 when not provided', () => {
    const { PORT, ...withoutPort } = validEnv;
    const result = envSchema.safeParse(withoutPort);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
    }
  });

  it('PORT="8080" transforms to number 8080', () => {
    const result = envSchema.safeParse({ ...validEnv, PORT: '8080' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
    }
  });
});
