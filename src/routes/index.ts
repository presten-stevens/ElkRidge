import { Router } from 'express';
import { healthRouter } from './health.js';
import { sendRouter } from './send.js';
import { conversationsRouter } from './conversations.js';

export const router = Router();

router.use(healthRouter);
router.use(sendRouter);
router.use(conversationsRouter);
