import { Router } from 'express';
import { sendRouter } from './send.js';
import { conversationsRouter } from './conversations.js';

export const router = Router();

router.use(sendRouter);
router.use(conversationsRouter);
