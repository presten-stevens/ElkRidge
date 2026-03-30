import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';
import type { BBSocketMessage } from '../types/bluebubbles.js';
import type {
  InboundMessagePayload,
  DeliveryConfirmationPayload,
  WebhookPayload,
} from '../types/webhook.js';

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

export async function relayToCRM(payload: WebhookPayload): Promise<void> {
  if (!env.CRM_WEBHOOK_URL) {
    logger.warn('CRM_WEBHOOK_URL not configured, skipping webhook relay');
    return;
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
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Webhook delivery to [CRM_WEBHOOK_URL] failed (network error)',
    );
  }
}
