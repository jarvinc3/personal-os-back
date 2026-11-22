import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import type { Env } from '@personal-os/config';
import { EmailSyncJob } from '@personal-os/core';
import { QueueNames } from '@personal-os/core';
import { USERS_REPOSITORY, type UsersRepositoryPort } from '@personal-os/users';
import type { EmailSenderPort } from '../application/ports/email-sender.port';
import { EMAIL_SENDER } from '../application/tokens';

/**
 * EMAIL delivery worker (A2).
 *
 * Sends notification emails via {@link EmailSenderPort} when
 * `EMAIL_DELIVERY_ENABLED=true`. With the flag off, jobs are skipped safely.
 */
@Injectable()
@Processor(QueueNames.EMAIL_SYNC)
export class EmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailSyncProcessor.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
  ) {
    super();
  }

  async process(job: Job<EmailSyncJob>): Promise<void> {
    const { userId, template, to, subject, body } = job.data;
    const deliveryEnabled = this.config.get('EMAIL_DELIVERY_ENABLED', {
      infer: true,
    });
    const jobId = job.id;

    if (!deliveryEnabled) {
      this.logger.warn(
        { jobId, userId, template },
        'EMAIL delivery disabled: email-sync job skipped',
      );
      return;
    }

    if (!subject?.trim()) {
      this.logger.warn({ jobId }, 'Email sync job skipped: empty subject');
      return;
    }

    const recipient = await this.resolveRecipient(userId, to);
    if (!recipient) {
      this.logger.warn(
        { jobId, userId },
        'Email sync job skipped: no recipient',
      );
      return;
    }

    await this.emailSender.send({
      to: recipient,
      subject: subject.trim(),
      text: body ?? '',
    });

    this.logger.log(
      { jobId, userId, template, to: maskRecipient(recipient) },
      'EMAIL sent',
    );
  }

  /** Explicit recipient first, then the profile email; empty when neither exists. */
  private async resolveRecipient(
    userId: string,
    requestedTo: string | undefined,
  ): Promise<string> {
    const explicitTo = requestedTo?.trim();
    if (explicitTo) {
      return explicitTo;
    }
    const user = await this.usersRepository.findById(userId);
    return user?.email?.trim() ?? '';
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailSyncJob>, error: Error) {
    this.logger.error(
      { jobId: job.id, error: error.message },
      'Email sync job failed',
    );
  }
}

/** Keeps the domain for correlation; the local part never reaches the logs. */
function maskRecipient(address: string): string {
  const domain = address.split('@')[1];
  return domain ? `***@${domain}` : '***';
}
