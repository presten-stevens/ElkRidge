export interface InboundMessagePayload {
  type: 'inbound_message';
  messageId: string;
  sender: string;
  body: string;
  timestamp: string;
  threadId: string;
}

export interface DeliveryConfirmationPayload {
  type: 'delivery_confirmation';
  messageId: string;
  status: string;
  timestamp: string;
}

export type WebhookPayload = InboundMessagePayload | DeliveryConfirmationPayload;
