import { io, type Socket } from 'socket.io-client';
import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';
import { DedupBuffer } from './dedup.js';
import { mapInboundMessage, mapDeliveryConfirmation, relayWithRetry } from './webhook-relay.js';
import { writeSyncState } from './sync-state.js';
import { runBackfill } from './backfill.js';
import { getBBClient } from './bluebubbles.js';
import type { BBSocketMessage } from '../types/bluebubbles.js';

let socket: Socket | null = null;
let dedup: DedupBuffer | null = null;
let isFirstConnect = true;

async function handleNewMessage(data: BBSocketMessage): Promise<void> {
  try {
    if (data.isFromMe) return;
    if (dedup?.isDuplicate(data.guid)) return;

    const payload = mapInboundMessage(data);
    logger.info(
      { sender: payload.sender, body: payload.body, threadId: payload.threadId, messageId: payload.messageId },
      'Inbound message received',
    );
    await relayWithRetry(payload);
    await writeSyncState(new Date(data.dateCreated).toISOString());
    logger.info({ messageId: payload.messageId }, 'Inbound message processed');
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
    logger.info(
      { messageId: payload.messageId, status: payload.status },
      'Delivery confirmation received',
    );
    await relayWithRetry(payload);
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
    query: { password: env.BLUEBUBBLES_PASSWORD },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    logger.info('Connected to BlueBubbles WebSocket');
    if (isFirstConnect) {
      isFirstConnect = false;
    } else {
      // Reconnect -- fire-and-forget backfill (per D-07, D-11)
      runBackfill(getBBClient(), dedup!).catch((err) =>
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Reconnect backfill failed'),
      );
    }
  });
  socket.on('disconnect', (reason) =>
    logger.warn({ reason }, 'Disconnected from BlueBubbles WebSocket'),
  );
  socket.on('connect_error', () =>
    logger.error('BlueBubbles WebSocket connection error'),
  );
  socket.on('new-message', (data: BBSocketMessage) => handleNewMessage(data));
  socket.on('updated-message', (data: BBSocketMessage) => handleUpdatedMessage(data));
}

export function getDedup(): DedupBuffer | null {
  return dedup;
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
  isFirstConnect = true;
}
