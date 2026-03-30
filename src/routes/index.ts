import { Router } from 'express';
import { sendRouter } from './send.js';

export const router = Router();

router.use(sendRouter);
