import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { Env } from '@personal-os/config';
import type { PushPayload, PushSendResult } from './push-sender.types';

const FCM_APP_NAME = 'personal-os-push';
const FCM_CHUNK_SIZE = 500;

/** Codes that mean the device can never receive again; the token is dropped. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function textData(
  payloadData?: Record<string, unknown>,
): Record<string, string> {
  const text: Record<string, string> = {};
  for (const [key, value] of Object.entries(payloadData ?? {})) {
    // FCM only carries text; anything else would ship as "[object Object]".
    if (typeof value === 'string') {
      text[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      text[key] = String(value);
    }
  }
  return text;
}

/**
 * Android push through Firebase Cloud Messaging. The service account comes from
 * the environment (inline JSON or a path outside the repository) and is never
 * logged or stored here; without it the channel stays off and the rest of the
 * notifications keep flowing.
 */
@Injectable()
export class FcmPushService {
  private readonly logger = new Logger(FcmPushService.name);
  private messagingPromise: Promise<Messaging | null> | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(
    tokens: readonly string[],
    payload: PushPayload,
  ): Promise<PushSendResult> {
    if (tokens.length === 0) {
      return { sent: 0, failed: 0, deactivatedTokens: [] };
    }

    const messaging = await this.messaging();
    if (!messaging) {
      this.logger.warn('FCM skipped: no service account configured');
      return { sent: 0, failed: tokens.length, deactivatedTokens: [] };
    }

    let sent = 0;
    let failed = 0;
    const deactivatedTokens: string[] = [];

    for (let offset = 0; offset < tokens.length; offset += FCM_CHUNK_SIZE) {
      const chunk = tokens.slice(offset, offset + FCM_CHUNK_SIZE);
      const response = await messaging.sendEachForMulticast({
        tokens: [...chunk],
        notification: { title: payload.title, body: payload.body },
        data: textData(payload.data),
      });
      sent += response.successCount;
      failed += response.failureCount;

      response.responses.forEach((delivery, index) => {
        if (delivery.success) {
          return;
        }
        const code = delivery.error?.code ?? '';
        if (DEAD_TOKEN_CODES.has(code)) {
          deactivatedTokens.push(chunk[index]);
        }
        this.logger.warn(`FCM rejected a token: ${code || 'unknown'}`);
      });
    }

    return { sent, failed, deactivatedTokens };
  }

  private messaging(): Promise<Messaging | null> {
    if (!this.messagingPromise) {
      this.messagingPromise = this.createMessaging();
    }
    return this.messagingPromise;
  }

  private async createMessaging(): Promise<Messaging | null> {
    const inlineJson = this.config.get('FIREBASE_SERVICE_ACCOUNT_JSON', {
      infer: true,
    });
    const credentialPath = this.config.get('FIREBASE_SERVICE_ACCOUNT_PATH', {
      infer: true,
    });

    try {
      const serviceAccount = await this.readServiceAccount(
        inlineJson,
        credentialPath,
      );
      if (!serviceAccount) {
        return null;
      }
      const existing = getApps().find((app) => app.name === FCM_APP_NAME);
      const app =
        existing ??
        initializeApp({ credential: cert(serviceAccount) }, FCM_APP_NAME);
      return getMessaging(app);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`FCM credential could not be loaded: ${message}`);
      return null;
    }
  }

  private async readServiceAccount(
    inlineJson: string | undefined,
    credentialPath: string | undefined,
  ): Promise<object | null> {
    if (inlineJson) {
      return JSON.parse(inlineJson) as object;
    }
    if (!credentialPath) {
      return null;
    }
    const fromFile = await readFile(credentialPath, 'utf8');
    return JSON.parse(fromFile) as object;
  }
}
