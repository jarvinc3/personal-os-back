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
    this.logger.log(
      `Email sync job ${job.id ?? 'unknown'} for user ${job.data.userId} template=${job.data.template}`,
    );
    // Stub: integrate Gmail API sender here.
    await Promise.resolve();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailSyncJob>, error: Error) {
    this.logger.error(
      `Email sync job ${job.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
