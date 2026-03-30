import { Router } from 'express';
import { z } from 'zod';
import { normalizePhone } from '../utils/phone.js';
import { getBBClient } from '../services/bluebubbles.js';
import { getRateLimiter } from '../services/rate-limiter.js';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';
import { logger } from '../middleware/logger.js';

const sendSchema = z.object({
  to: z.string().min(1, 'Phone number is required'),
  message: z.string().min(1, 'Message body is required').max(5000),
});

export const sendRouter = Router();

sendRouter.post('/send', async (req, res) => {
  // 1. Validate request body with Zod (D-12)
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues.map((i) => i.message).join(', '),
      ERROR_CODES.VALIDATION_ERROR,
      false,
      400,
    );
  }

  // 2. Normalize phone to E.164 (D-12)
  let phone: string;
  try {
    phone = normalizePhone(parsed.data.to);
  } catch {
    throw new AppError(
      `Invalid phone number: ${parsed.data.to}`,
      ERROR_CODES.INVALID_PHONE,
      false,
      400,
    );
  }

  // 3. Check rate limit (D-08)
  const limiter = getRateLimiter();
  if (!limiter.consume()) {
    throw new AppError(
      'Rate limit exceeded. Try again later.',
      ERROR_CODES.RATE_LIMITED,
      true,
      429,
    );
  }

  // 4. Generate tempGuid for immediate response (Pitfall 3: don't block on jitter)
  const tempGuid = crypto.randomUUID();

  // 5. Fire-and-forget: jitter delay + BB send (D-13, Pitfall 3)
  const jitterMs = limiter.getJitterMs();
  const client = getBBClient();

  // Async send -- do NOT await. Response returns immediately with "queued".
  const sendPromise = new Promise<void>((resolve) => {
    setTimeout(async () => {
      try {
        await client.sendMessage(phone, parsed.data.message);
        logger.info({ tempGuid, phone, jitterMs }, 'Message sent to BlueBubbles');
      } catch (err) {
        logger.error(
          { tempGuid, phone, err: err instanceof Error ? err.message : err },
          'Failed to send message to BlueBubbles',
        );
      }
      resolve();
    }, jitterMs);
  });

  // Prevent unhandled rejection
  sendPromise.catch(() => {});

  // 6. Return immediately with queued status (D-13, SEND-03)
  res.status(200).json({
    messageId: tempGuid,
    status: 'queued' as const,
  });
});
