import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';
import { RetryQueue } from './retry-queue.js';
import type { BBSocketMessage } from '../types/bluebubbles.js';
import type {
  InboundMessagePayload,
  DeliveryConfirmationPayload,
  WebhookPayload,
} from '../types/webhook.js';

let retryQueue: RetryQueue | null = null;

export function mapInboundMessage(data: BBSocketMessage): InboundMessagePayload {
  return {
    type: 'inbound_message',
    messageId: data.guid,
    sender: data.handle?.address ?? 'Unknown',
    body: data.text ?? '',
    timestamp: new Date(data.dateCreated).toISOString(),
    threadId: data.chats?.[0]?.guid ?? '',
  };
}

export function mapDeliveryConfirmation(data: BBSocketMessage): DeliveryConfirmationPayload {
  const status = data.dateRead > 0 ? 'read' : data.dateDelivered > 0 ? 'delivered' : 'unknown';
  return {
    type: 'delivery_confirmation',
    messageId: data.guid,
    status,
    timestamp: new Date(data.dateDelivered || data.dateRead || data.dateCreated).toISOString(),
  };
}

async function deliverOnce(payload: WebhookPayload): Promise<boolean> {
  if (!env.CRM_WEBHOOK_URL) {
    logger.warn('CRM_WEBHOOK_URL not configured, skipping webhook relay');
    return true;
  }

  try {
    const response = await fetch(env.CRM_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, statusText: response.statusText },
        'Webhook delivery to [CRM_WEBHOOK_URL] failed',
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Webhook delivery to [CRM_WEBHOOK_URL] failed (network error)',
    );
    return false;
  }
}

export async function relayToCRM(payload: WebhookPayload): Promise<boolean> {
  return deliverOnce(payload);
}

export function initRelay(): void {
  retryQueue = new RetryQueue(env.RETRY_QUEUE_MAX_SIZE ?? 1000, 5, deliverOnce);
  retryQueue.start();
}

export function shutdownRelay(): void {
  retryQueue?.destroy();
  retryQueue = null;
}

export async function relayWithRetry(payload: WebhookPayload): Promise<void> {
  const success = await relayToCRM(payload);
  if (!success && retryQueue) {
    retryQueue.enqueue(payload);
  }
}
