import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { GmailSyncJob } from '../../../../core/queues/queue-jobs';
import { QueueNames } from '../../../../core/queues/queue.constants';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import {
  GMAIL_AUTO_SYNC_INTERVAL_MS,
  GMAIL_SYNC_JOB_NAME,
  GMAIL_SYNC_JOB_OPTIONS,
  gmailSyncJobId,
} from './gmail-sync.constants';

@Injectable()
export class EnqueueDueGmailSyncsUseCase {
  private readonly logger = new Logger(EnqueueDueGmailSyncsUseCase.name);

  constructor(
    private readonly repo: EmailSourceRepository,
    @Optional()
    @InjectQueue(QueueNames.GMAIL_SYNC)
    private readonly gmailSyncQueue?: Queue<GmailSyncJob>,
  ) {}

  async execute(): Promise<{ queued: number; skipped: number }> {
    if (!this.gmailSyncQueue) {
      this.logger.warn(
        'gmail-sync queue is unavailable; skipping automatic sync',
      );
      return { queued: 0, skipped: 0 };
    }

    const cutoff = new Date(Date.now() - GMAIL_AUTO_SYNC_INTERVAL_MS);
    const sources = await this.repo.listDueGmailSyncSources(cutoff);
    let queued = 0;
    let skipped = 0;

    for (const source of sources) {
      try {
        await this.gmailSyncQueue.add(
          GMAIL_SYNC_JOB_NAME,
          {
            userId: source.userId,
            sourceId: source.id,
            forceFullSync: false,
          },
          {
            ...GMAIL_SYNC_JOB_OPTIONS,
            jobId: gmailSyncJobId(source.id),
          },
        );
        queued += 1;
      } catch (error) {
        skipped += 1;
        const message = error instanceof Error ? error.message : 'unknown';
        this.logger.debug(
          `Skip Gmail auto-sync for ${source.id}: ${message}`,
        );
      }
    }

    if (queued > 0 || skipped > 0) {
      this.logger.log(
        `Gmail auto-sync enqueue: queued=${queued} skipped=${skipped}`,
      );
    }

    return { queued, skipped };
  }
}
