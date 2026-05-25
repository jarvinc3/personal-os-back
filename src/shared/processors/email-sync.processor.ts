import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueNames } from '../../core/queues/queue.constants';
import { EmailSyncJob } from '../../core/queues/queue-jobs';

@Injectable()
@Processor(QueueNames.EMAIL_SYNC)
export class EmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailSyncProcessor.name);

  async process(job: Job<EmailSyncJob>): Promise<void> {
    const { userId, template, to, subject } = job.data;

    if (!subject?.trim()) {
      this.logger.warn(`Email sync job ${job.id ?? 'unknown'} skipped: empty subject`);
      return;
    }

    this.logger.log(
      `Email sync job ${job.id ?? 'unknown'} user=${userId} template=${template} to=${to || '(from profile)'} subject="${subject.slice(0, 80)}"`,
    );

    // Gmail API integration: resolve recipient, send via OAuth-backed transport.
    await Promise.resolve();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailSyncJob>, error: Error) {
    this.logger.error(
      `Email sync job ${job.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
