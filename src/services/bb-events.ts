import { io, type Socket } from 'socket.io-client';
import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';
import { DedupBuffer } from './dedup.js';
import { mapInboundMessage, mapDeliveryConfirmation, relayToCRM } from './webhook-relay.js';
import { writeSyncState } from './sync-state.js';
import type { BBSocketMessage } from '../types/bluebubbles.js';

let socket: Socket | null = null;
let dedup: DedupBuffer | null = null;

async function handleNewMessage(data: BBSocketMessage): Promise<void> {
  try {
    if (data.isFromMe) return;
    if (dedup?.isDuplicate(data.guid)) return;

    const payload = mapInboundMessage(data);
    await relayToCRM(payload);
    await writeSyncState(new Date(data.dateCreated).toISOString());
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Error processing new-message event',
    );
  }
}

async function handleUpdatedMessage(data: BBSocketMessage): Promise<void> {
  try {
    if (!data.isFromMe) return;
    if (dedup?.isDuplicate(data.guid)) return;

    const payload = mapDeliveryConfirmation(data);
    await relayToCRM(payload);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Error processing updated-message event',
    );
  }
}

export function initBBEvents(): void {
  dedup = new DedupBuffer();

  socket = io(env.BLUEBUBBLES_URL, {
    auth: { password: env.BLUEBUBBLES_PASSWORD },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => logger.info('Connected to BlueBubbles WebSocket'));
  socket.on('disconnect', (reason) =>
    logger.warn({ reason }, 'Disconnected from BlueBubbles WebSocket'),
  );
  socket.on('connect_error', () =>
    logger.error('BlueBubbles WebSocket connection error'),
  );
  socket.on('new-message', (data: BBSocketMessage) => handleNewMessage(data));
  socket.on('updated-message', (data: BBSocketMessage) => handleUpdatedMessage(data));
}

export function shutdownBBEvents(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (dedup) {
    dedup.destroy();
    dedup = null;
  }
}
