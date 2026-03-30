import { Router } from 'express';
import { checkHealth } from '../services/health.js';
import { getBBClient } from '../services/bluebubbles.js';
import { getLastChecked } from '../services/health-monitor.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const result = await checkHealth(getBBClient());
  result.lastChecked = getLastChecked();
  res.json(result);
});
