import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config';

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
};

type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

type ExpoPushResponse = {
  data: ExpoPushTicket[];
};

@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);
  private readonly expoAccessToken?: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.expoAccessToken = this.config.get('EXPO_ACCESS_TOKEN', { infer: true });
  }

  async sendToTokens(
    tokens: string[],
    payload: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<{ sent: number; failed: number }> {
    const expoTokens = tokens.filter((token) => token.startsWith('ExponentPushToken['));

    if (expoTokens.length === 0) {
      this.logger.warn('No Expo push tokens to send to');
      return { sent: 0, failed: tokens.length };
    }

    const messages: ExpoPushMessage[] = expoTokens.map((token) => ({
      to: token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: 'default',
    }));

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (this.expoAccessToken) {
      headers.Authorization = `Bearer ${this.expoAccessToken}`;
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Expo push API error ${response.status}: ${text}`);
      return { sent: 0, failed: expoTokens.length };
    }

    const result = (await response.json()) as ExpoPushResponse;
    let sent = 0;
    let failed = 0;

    for (const ticket of result.data ?? []) {
      if (ticket.status === 'ok') {
        sent += 1;
      } else {
        failed += 1;
        this.logger.warn(
          `Expo push ticket error: ${ticket.message ?? 'unknown'} ${ticket.details?.error ?? ''}`,
        );
      }
    }

    return { sent, failed };
  }
}
