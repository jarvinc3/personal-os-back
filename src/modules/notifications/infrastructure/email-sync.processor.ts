import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueNames } from '../../../core/queues/queue.constants';
import { EmailSyncJob } from '../../../core/queues/queue-jobs';

/**
 * EMAIL delivery stub (decision A1).
 *
 * This processor intentionally does **not** send real email.
 * Do not treat the EMAIL notification channel as production-ready.
 * A future phase may wire Gmail API / OAuth-backed transport here.
 */
@Injectable()
@Processor(QueueNames.EMAIL_SYNC)
export class EmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailSyncProcessor.name);

  async process(job: Job<EmailSyncJob>): Promise<void> {
    const { userId, template, to, subject } = job.data;

    this.logger.warn(
      `EMAIL stub (A1): email-sync job ${job.id ?? 'unknown'} not sent — EMAIL is not production-ready ` +
        `(user=${userId} template=${template} to=${to || '(from profile)'} subject="${(subject ?? '').slice(0, 80)}")`,
    );

    if (!subject?.trim()) {
      this.logger.warn(`Email sync job ${job.id ?? 'unknown'} skipped: empty subject`);
      return;
    }

    // No-op: real send is out of scope for A1.
    await Promise.resolve();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailSyncJob>, error: Error) {
    this.logger.error(
      `Email sync job ${job.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
