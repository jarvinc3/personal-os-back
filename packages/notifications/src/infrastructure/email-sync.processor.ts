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

    if (!deliveryEnabled) {
      this.logger.warn(
        `EMAIL delivery disabled: email-sync job ${job.id ?? 'unknown'} skipped ` +
          `(user=${userId} template=${template})`,
      );
      return;
    }

    if (!subject?.trim()) {
      this.logger.warn(
        `Email sync job ${job.id ?? 'unknown'} skipped: empty subject`,
      );
      return;
    }

    const explicitTo = to?.trim();
    let recipient = explicitTo || '';
    if (!recipient) {
      const user = await this.usersRepository.findById(userId);
      recipient = user?.email?.trim() ?? '';
    }

    if (!recipient) {
      this.logger.warn(
        `Email sync job ${job.id ?? 'unknown'} skipped: no recipient ` +
          `(user=${userId} to empty and profile email missing)`,
      );
      return;
    }

    await this.emailSender.send({
      to: recipient,
      subject: subject.trim(),
      text: body ?? '',
    });

    this.logger.log(
      `EMAIL sent for job ${job.id ?? 'unknown'} user=${userId} to=${recipient} ` +
        `template=${template}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailSyncJob>, error: Error) {
    this.logger.error(
      `Email sync job ${job.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
