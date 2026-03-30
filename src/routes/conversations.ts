import { Router } from 'express';
import { z } from 'zod';
import { getBBClient } from '../services/bluebubbles.js';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';

const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).default(25).transform((v) => Math.min(v, 100)),
});

export const conversationsRouter = Router();

conversationsRouter.get('/conversations', async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues.map((i) => i.message).join(', '),
      ERROR_CODES.VALIDATION_ERROR,
      false,
      400,
    );
  }

  const { offset, limit } = parsed.data;
  const client = getBBClient();
  const result = await client.getConversations(offset, limit);
  res.json(result);
});

conversationsRouter.get('/conversations/:id', async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues.map((i) => i.message).join(', '),
      ERROR_CODES.VALIDATION_ERROR,
      false,
      400,
    );
  }

  const { offset, limit } = parsed.data;
  const chatGuid = req.params.id;
  const client = getBBClient();
  const result = await client.getMessages(chatGuid, offset, limit);
  res.json(result);
});
