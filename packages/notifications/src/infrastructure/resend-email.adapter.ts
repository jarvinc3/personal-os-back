import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type {
  EmailSendInput,
  EmailSenderPort,
} from '../application/ports/email-sender.port';

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;

@Injectable()
export class ResendEmailAdapter implements EmailSenderPort {
  private readonly logger = new Logger(ResendEmailAdapter.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(input: EmailSendInput): Promise<void> {
    const apiKey = this.config.get('RESEND_API_KEY', { infer: true });
    const from = this.config.get('MAIL_FROM', { infer: true });

    if (!apiKey || !from) {
      throw new Error(
        'Resend email send aborted: RESEND_API_KEY or MAIL_FROM is not configured',
      );
    }

    let response: Response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
        }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Resend request failed: ${message}`);
      throw new Error(`Resend request failed: ${message}`, { cause: error });
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Resend API error ${response.status}: ${body}`);
      throw new Error(`Resend API error ${response.status}: ${body}`);
    }
  }
}
