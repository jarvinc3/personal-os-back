import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import type { Env } from '@personal-os/config';
import { NotificationsRepository } from './notifications.repository';
import { FcmPushService } from './fcm-push.service';
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

function isLegacyExpoToken(entry: PushTokenEntry): boolean {
  return entry.token.startsWith('ExponentPushToken[');
}

function isAndroidToken(entry: PushTokenEntry): boolean {
  return entry.platform === 'android' && !isLegacyExpoToken(entry);
}

function isWebToken(entry: PushTokenEntry): boolean {
  return entry.platform === 'web';
}

function noSend(): PushSendResult {
  return { sent: 0, failed: 0, deactivatedTokens: [] };
}

@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);
  private readonly expoAccessToken?: string;
  private readonly webPushConfigured: boolean;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly notificationsRepo: NotificationsRepository,
    private readonly fcm: FcmPushService,
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
    const legacyExpoTokens = entries
      .filter(isLegacyExpoToken)
      .map((entry) => entry.token);
    const androidTokens = entries
      .filter(isAndroidToken)
      .map((entry) => entry.token);
    const webEntries = entries.filter(isWebToken);

    // iOS has no native channel yet: those tokens are ignored, not failed.
    const [expoResult, fcmResult, webResult] = await Promise.all([
      this.sendExpoTokens(legacyExpoTokens, payload),
      androidTokens.length > 0
        ? this.fcm.send(androidTokens, payload)
        : noSend(),
      this.sendWebTokens(webEntries, payload),
    ]);

    return {
      sent: expoResult.sent + fcmResult.sent + webResult.sent,
      failed: expoResult.failed + fcmResult.failed + webResult.failed,
      deactivatedTokens: [
        ...expoResult.deactivatedTokens,
        ...fcmResult.deactivatedTokens,
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
      // The cast trusts the provider shape; a response without `data` still
      // means "no tickets" like before.
      const tickets = this.readExpoTickets({
        tickets: result.data ?? [],
        chunk,
      });

      sent += tickets.sent;
      failed += tickets.failed;
      deactivatedTokens.push(...tickets.deactivatedTokens);
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

  /**
   * Counts the tickets of one Expo chunk and flags the tokens the provider
   * asked to drop. Tickets and chunk may differ in length; a missing token is
   * not counted.
   */
  private readExpoTickets({
    tickets,
    chunk,
  }: {
    tickets: ExpoPushTicket[];
    chunk: string[];
  }): PushSendResult {
    const outcome: PushSendResult = {
      sent: 0,
      failed: 0,
      deactivatedTokens: [],
    };

    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      if (ticket.status === 'ok') {
        outcome.sent += 1;
        continue;
      }

      outcome.failed += 1;
      if (ticket.details?.error === 'DeviceNotRegistered') {
        outcome.deactivatedTokens.push(chunk[index]);
      }
      this.logger.warn(
        `Expo push ticket error: ${ticket.message ?? 'unknown'} ${ticket.details?.error ?? ''}`,
      );
    }

    return outcome;
  }
}
