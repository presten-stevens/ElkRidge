import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';

describe('logger redaction', () => {
  function createTestLogger() {
    const output: string[] = [];
    const dest = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const testLogger = pino(
      {
        redact: {
          paths: [
            'password',
            '*.password',
            '*.bluebubbles_password',
            '*.BLUEBUBBLES_PASSWORD',
            'req.headers.authorization',
            'req.query.password',
          ],
          censor: '[REDACTED]',
        },
      },
      dest,
    );
    return { logger: testLogger, output, dest };
  }

  it('redacts top-level password field', () => {
    const { logger, output, dest } = createTestLogger();
    logger.info({ password: 'my-secret-pw' }, 'test');
    logger.flush();
    // pino writes synchronously to Writable streams
    dest.end();
    const logLine = output.join('');
    expect(logLine).toContain('[REDACTED]');
    expect(logLine).not.toContain('my-secret-pw');
  });

  it('redacts nested bluebubbles_password field', () => {
    const { logger, output, dest } = createTestLogger();
    logger.info({ config: { bluebubbles_password: 'bb-secret' } }, 'test');
    logger.flush();
    dest.end();
    const logLine = output.join('');
    expect(logLine).toContain('[REDACTED]');
    expect(logLine).not.toContain('bb-secret');
  });
});
