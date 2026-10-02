import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import type { Env } from '@personal-os/config';
import { NotificationsRepository } from './notifications.repository';
import type {
  PushPayload,
  PushSendResult,
  PushTokenEntry,
} from './push-sender.types';

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

const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_PUSH_TIMEOUT_MS = 10_000;

function isExpoToken(entry: PushTokenEntry): boolean {
  return (
    entry.platform === 'ios' ||
    entry.platform === 'android' ||
    entry.token.startsWith('ExponentPushToken[')
  );
}

function isWebToken(entry: PushTokenEntry): boolean {
  return entry.platform === 'web';
}

@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);
  private readonly expoAccessToken?: string;
  private readonly webPushConfigured: boolean;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly notificationsRepo: NotificationsRepository,
  ) {
    this.expoAccessToken = this.config.get('EXPO_ACCESS_TOKEN', {
      infer: true,
    });

    const vapidPublicKey = this.config.get('VAPID_PUBLIC_KEY', { infer: true });
    const vapidPrivateKey = this.config.get('VAPID_PRIVATE_KEY', {
      infer: true,
    });
    const vapidSubject = this.config.get('VAPID_SUBJECT', { infer: true });

    if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.webPushConfigured = true;
    } else {
      this.webPushConfigured = false;
    }
  }

  async sendToTokenEntries(
    entries: PushTokenEntry[],
    payload: PushPayload,
  ): Promise<PushSendResult> {
    const expoEntries = entries.filter(isExpoToken);
    const webEntries = entries.filter(isWebToken);

    const [expoResult, webResult] = await Promise.all([
      this.sendExpoTokens(
        expoEntries.map((entry) => entry.token),
        payload,
      ),
      this.sendWebTokens(webEntries, payload),
    ]);

    return {
      sent: expoResult.sent + webResult.sent,
      failed: expoResult.failed + webResult.failed,
      deactivatedTokens: [
        ...expoResult.deactivatedTokens,
        ...webResult.deactivatedTokens,
      ],
    };
  }

  private async sendExpoTokens(
    tokens: string[],
    payload: PushPayload,
  ): Promise<PushSendResult> {
    const expoTokens = tokens.filter((token) =>
      token.startsWith('ExponentPushToken['),
    );

    if (expoTokens.length === 0) {
      return { sent: 0, failed: 0, deactivatedTokens: [] };
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (this.expoAccessToken) {
      headers.Authorization = `Bearer ${this.expoAccessToken}`;
    }

    let sent = 0;
    let failed = 0;
    const deactivatedTokens: string[] = [];

    for (
      let offset = 0;
      offset < expoTokens.length;
      offset += EXPO_PUSH_CHUNK_SIZE
    ) {
      const chunk = expoTokens.slice(offset, offset + EXPO_PUSH_CHUNK_SIZE);
      const messages: ExpoPushMessage[] = chunk.map((token) => ({
        to: token,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        sound: 'default',
      }));

      let response: Response;
      try {
        response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers,
          body: JSON.stringify(messages),
          signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Expo push request failed: ${message}`);
        failed += chunk.length;
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(`Expo push API error ${response.status}: ${text}`);
        failed += chunk.length;
        continue;
      }

      const result = (await response.json()) as ExpoPushResponse;

      for (let index = 0; index < (result.data ?? []).length; index += 1) {
        const ticket = result.data[index];
        const token = chunk[index];
        if (ticket.status === 'ok') {
          sent += 1;
        } else {
          failed += 1;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            deactivatedTokens.push(token);
          }
          this.logger.warn(
            `Expo push ticket error: ${ticket.message ?? 'unknown'} ${ticket.details?.error ?? ''}`,
          );
        }
      }
    }

    return { sent, failed, deactivatedTokens };
  }

  private async sendWebTokens(
    entries: PushTokenEntry[],
    payload: PushPayload,
  ): Promise<PushSendResult> {
    if (entries.length === 0) {
      return { sent: 0, failed: 0, deactivatedTokens: [] };
    }

    if (!this.webPushConfigured) {
      this.logger.warn('Web Push skipped: VAPID keys are not configured');
      return { sent: 0, failed: entries.length, deactivatedTokens: [] };
    }

    let sent = 0;
    let failed = 0;
    const deactivatedTokens: string[] = [];

    for (const entry of entries) {
      try {
        const subscription = JSON.parse(
          entry.token,
        ) as webpush.PushSubscription;
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            data: payload.data ?? {},
          }),
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : undefined;

        if (statusCode === 404 || statusCode === 410) {
          deactivatedTokens.push(entry.token);
        }

        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Web push failed for token: ${message}`);
      }
    }

    return { sent, failed, deactivatedTokens };
  }

  async deactivateInvalidTokens(tokens: string[]): Promise<void> {
    await Promise.all(
      tokens.map((token) =>
        this.notificationsRepo.deactivatePushTokenByToken(token),
      ),
    );
  }
}
