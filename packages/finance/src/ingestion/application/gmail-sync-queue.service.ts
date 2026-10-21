import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { GmailSyncJob } from '@personal-os/core';
import { QueueNames } from '@personal-os/core';
import {
  GMAIL_SYNC_JOB_NAME,
  GMAIL_SYNC_JOB_OPTIONS,
  gmailSyncJobId,
} from './gmail-sync.constants';

/** Puts a Gmail sync on the queue, or explains why it could not. */
@Injectable()
export class GmailSyncQueueService {
  private readonly logger = new Logger(GmailSyncQueueService.name);

  constructor(
    @Optional()
    @InjectQueue(QueueNames.GMAIL_SYNC)
    private readonly gmailSyncQueue?: Queue<GmailSyncJob>,
  ) {}

  async enqueue(
    userId: string,
    sourceId: string,
    options: { forceFullSync?: boolean } = {},
  ): Promise<{ queued: true } | { queued: false; reason: string }> {
    const forceFullSync = options.forceFullSync === true;
    if (!this.gmailSyncQueue) {
      return {
        queued: false,
        reason:
          'gmail-sync queue is unavailable. Verify REDIS_ENABLED=true and REDIS_URL, then restart the API.',
      };
    }

    try {
      await this.gmailSyncQueue.add(
        GMAIL_SYNC_JOB_NAME,
        { userId, sourceId, forceFullSync },
        {
          ...GMAIL_SYNC_JOB_OPTIONS,
          jobId: gmailSyncJobId(sourceId),
        },
      );
      return { queued: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `Failed to enqueue Gmail sync for ${sourceId}: ${message}`,
      );
      return {
        queued: false,
        reason: `Could not enqueue gmail-sync: ${message}`,
      };
    }
  }
}
