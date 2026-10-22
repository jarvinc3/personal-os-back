import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { Env } from '@personal-os/config';
import type { PushPayload, PushSendResult } from './push-sender.types';

const FCM_APP_NAME = 'personal-os-push';
const FCM_CHUNK_SIZE = 500;

type FcmCredentialVariable =
  'FIREBASE_PROJECT_ID' | 'FIREBASE_CLIENT_EMAIL' | 'FIREBASE_PRIVATE_KEY';

type FcmCredential = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

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
 * Android push through Firebase Cloud Messaging. The service account is built
 * from three separate environment variables and is never logged or stored here;
 * without it the channel stays off and the rest of the notifications keep
 * flowing.
 */
@Injectable()
export class FcmPushService implements OnModuleInit {
  private readonly logger = new Logger(FcmPushService.name);
  private messagingPromise: Promise<Messaging | null> | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    await this.messaging();
  }

  async send(
    tokens: readonly string[],
    payload: PushPayload,
  ): Promise<PushSendResult> {
    if (tokens.length === 0) {
      return { sent: 0, failed: 0, deactivatedTokens: [] };
    }

    const messaging = await this.messaging();
    if (!messaging) {
      this.logger.warn('FCM skipped: credential not configured');
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
      this.messagingPromise = Promise.resolve(this.createMessaging());
    }
    return this.messagingPromise;
  }

  private createMessaging(): Messaging | null {
    const credential = this.readCredential();
    if (!credential) {
      return null;
    }

    try {
      const existing = getApps().find((app) => app.name === FCM_APP_NAME);
      const app =
        existing ??
        initializeApp({ credential: cert(credential) }, FCM_APP_NAME);
      return getMessaging(app);
    } catch (error) {
      this.logger.error(
        `FCM credential could not be loaded: ${this.safeErrorMessage(error)}`,
      );
      return null;
    }
  }

  private readCredential(): FcmCredential | null {
    const projectId = this.config.get('FIREBASE_PROJECT_ID', { infer: true });
    const clientEmail = this.config.get('FIREBASE_CLIENT_EMAIL', {
      infer: true,
    });
    const privateKey = this.config.get('FIREBASE_PRIVATE_KEY', { infer: true });

    if (!projectId || !clientEmail || !privateKey) {
      const missing = [
        !projectId ? 'FIREBASE_PROJECT_ID' : null,
        !clientEmail ? 'FIREBASE_CLIENT_EMAIL' : null,
        !privateKey ? 'FIREBASE_PRIVATE_KEY' : null,
      ].filter((name): name is FcmCredentialVariable => name !== null);
      this.logger.warn(`FCM skipped: missing ${missing.join(', ')}`);
      return null;
    }

    return {
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    };
  }

  /** Removes PEM blocks so a credential error never echoes the private key. */
  private safeErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'unknown error';
    }
    const sanitized = error.message
      .replace(
        /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
        '[redacted private key]',
      )
      .replace(/\s+/g, ' ')
      .trim();
    return sanitized || 'unknown error';
  }
}
