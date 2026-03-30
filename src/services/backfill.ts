import { logger } from '../middleware/logger.js';
import { readSyncState, writeSyncState } from './sync-state.js';
import { relayWithRetry } from './webhook-relay.js';
import type { BlueBubblesClient } from './bluebubbles.js';
import type { DedupBuffer } from './dedup.js';
import type { InboundMessagePayload } from '../types/webhook.js';

export async function runBackfill(
  client: BlueBubblesClient,
  dedup: DedupBuffer,
): Promise<void> {
  const lastSynced = await readSyncState();

  if (lastSynced === null) {
    logger.info('No last_synced_at found, skipping backfill');
    return;
  }

  const afterMs = new Date(lastSynced).getTime();
  const limit = 100;
  let offset = 0;
  let backfilledCount = 0;

  while (true) {
    const messages = await client.getMessagesSince(afterMs, offset, limit);

    if (messages.length === 0) break;

    for (const msg of messages) {
      if (msg.isFromMe) continue;
      if (dedup.isDuplicate(msg.guid)) continue;

      const payload: InboundMessagePayload = {
        type: 'inbound_message',
        messageId: msg.guid,
        sender: msg.handle?.address ?? 'Unknown',
        body: msg.text ?? '',
        timestamp: new Date(msg.dateCreated).toISOString(),
        threadId: '',
      };

      await relayWithRetry(payload);
      await writeSyncState(new Date(msg.dateCreated).toISOString());
      backfilledCount++;
    }

    offset += messages.length;
    if (messages.length < limit) break;
  }

  logger.info({ count: backfilledCount }, 'Backfill complete');
}
