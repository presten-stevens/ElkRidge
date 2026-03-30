import crypto from 'node:crypto';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';
import { env } from '../config/env.js';
import type { BBChat, BBMessage } from '../types/bluebubbles.js';
import type { Conversation, Message, PaginatedResponse } from '../types/api.js';

export class BlueBubblesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
  ) {}

  private buildUrl(path: string): string {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set('password', this.password);
    return url.toString();
  }

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl(path), {
        ...options,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Do NOT log the raw error -- it may contain the password in the URL (Pitfall 1)
      throw new AppError(
        'BlueBubbles server is unreachable',
        ERROR_CODES.BB_OFFLINE,
        true,
        503,
      );
    }

    const body = (await response.json()) as { status: number; data: T; error?: { message?: string } };

    if (body.status !== 200) {
      throw new AppError(
        body.error?.message ?? 'BlueBubbles request failed',
        ERROR_CODES.SEND_FAILED,
        false,
        502,
      );
    }

    return body.data;
  }

  async requestWithMeta<T>(
    path: string,
    options?: RequestInit,
  ): Promise<{ data: T; metadata: { count: number; total: number; offset: number; limit: number } }> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl(path), {
        ...options,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError(
        'BlueBubbles server is unreachable',
        ERROR_CODES.BB_OFFLINE,
        true,
        503,
      );
    }

    const body = (await response.json()) as {
      status: number;
      data: T;
      metadata: { count: number; total: number; offset: number; limit: number };
      error?: { message?: string };
    };

    if (body.status !== 200) {
      throw new AppError(
        body.error?.message ?? 'BlueBubbles request failed',
        ERROR_CODES.SEND_FAILED,
        false,
        502,
      );
    }

    return { data: body.data, metadata: body.metadata };
  }

  async getConversations(
    offset: number,
    limit: number,
  ): Promise<PaginatedResponse<Conversation>> {
    const { data, metadata } = await this.requestWithMeta<BBChat[]>(
      '/api/v1/chat/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset, limit, with: ['lastMessage'] }),
      },
    );

    return {
      data: data.map(mapBBChatToConversation),
      pagination: { offset, limit, total: metadata.total },
    };
  }

  async getMessages(
    chatGuid: string,
    offset: number,
    limit: number,
  ): Promise<PaginatedResponse<Message>> {
    const { data, metadata } = await this.requestWithMeta<BBMessage[]>(
      `/api/v1/chat/${encodeURIComponent(chatGuid)}/message?offset=${offset}&limit=${limit}&sort=DESC`,
    );

    return {
      data: data.map(mapBBMessageToMessage),
      pagination: { offset, limit, total: metadata.total },
    };
  }

  async sendMessage(phone: string, message: string): Promise<{ guid: string; text: string }> {
    const tempGuid = crypto.randomUUID();
    return this.request<{ guid: string; text: string }>('/api/v1/message/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatGuid: `any;-;${phone}`,
        tempGuid: `temp-${tempGuid}`,
        message,
      }),
    });
  }
}

function mapBBChatToConversation(chat: BBChat): Conversation {
  return {
    id: chat.guid,
    contact:
      chat.chatIdentifier
      ?? chat.participants?.[0]?.address
      ?? chat.displayName
      ?? 'Unknown',
    lastMessage: chat.lastMessage?.text ?? '',
    timestamp: chat.lastMessage?.dateCreated
      ? new Date(chat.lastMessage.dateCreated).toISOString()
      : '',
    unreadCount: 0, // BB does not provide this field
  };
}

function mapBBMessageToMessage(msg: BBMessage): Message {
  return {
    id: msg.guid,
    sender: msg.isFromMe ? 'me' : (msg.handle?.address ?? 'Unknown'),
    body: msg.text ?? '',
    timestamp: new Date(msg.dateCreated).toISOString(),
    isFromMe: msg.isFromMe,
  };
}

let instance: BlueBubblesClient | null = null;

export function getBBClient(): BlueBubblesClient {
  if (!instance) {
    instance = new BlueBubblesClient(env.BLUEBUBBLES_URL, env.BLUEBUBBLES_PASSWORD);
  }
  return instance;
}
