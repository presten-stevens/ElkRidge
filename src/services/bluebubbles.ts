import crypto from 'node:crypto';
import { AppError } from '../types/errors.js';
import { ERROR_CODES } from '../types/error-codes.js';
import { env } from '../config/env.js';

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

  async sendMessage(phone: string, message: string): Promise<{ guid: string; text: string }> {
    const tempGuid = crypto.randomUUID();
    return this.request<{ guid: string; text: string }>('/api/v1/message/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatGuid: `any;-;+${phone}`,
        tempGuid: `temp-${tempGuid}`,
        message,
      }),
    });
  }
}

let instance: BlueBubblesClient | null = null;

export function getBBClient(): BlueBubblesClient {
  if (!instance) {
    instance = new BlueBubblesClient(env.BLUEBUBBLES_URL, env.BLUEBUBBLES_PASSWORD);
  }
  return instance;
}
