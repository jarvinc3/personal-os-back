import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { GmailSyncJob } from '../../../../core/queues/queue-jobs';
import { QueueNames } from '../../../../core/queues/queue.constants';
import {
  DEFAULT_EMAIL_SYNC_SCHEDULE,
  parseEmailSyncSchedule,
  type EmailSyncSchedule,
} from '../../../users';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import {
  GMAIL_SYNC_JOB_NAME,
  GMAIL_SYNC_JOB_OPTIONS,
  gmailSyncJobId,
} from './gmail-sync.constants';
import { isEmailSyncDue } from './gmail-sync-schedule';

@Injectable()
export class EnqueueDueGmailSyncsUseCase {
  private readonly logger = new Logger(EnqueueDueGmailSyncsUseCase.name);

  constructor(
    private readonly repo: EmailSourceRepository,
    @Optional()
    @InjectQueue(QueueNames.GMAIL_SYNC)
    private readonly gmailSyncQueue?: Queue<GmailSyncJob>,
  ) {}

  async execute(): Promise<void> {
    if (!this.gmailSyncQueue) {
      this.logger.warn(
        'gmail-sync queue is unavailable; skipping automatic sync',
      );
      return;
    }

    const sources = await this.repo.listAutoSyncSources();
    const now = new Date();
    let queued = 0;
    let skipped = 0;

    for (const source of sources) {
      const schedule = this.resolveSchedule(source);
      const due = isEmailSyncDue({
        lastSyncedAt: source.lastSyncedAt,
        schedule,
        timezone: source.user.timezone,
        now,
      });
      if (!due) {
        continue;
      }
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
        this.logger.debug(`Skip Gmail auto-sync for ${source.id}: ${message}`);
      }
    }

    if (queued > 0 || skipped > 0) {
      this.logger.log(
        `Gmail auto-sync enqueue: queued=${queued} skipped=${skipped}`,
      );
    }
  }

  private resolveSchedule(source: {
    id: string;
    user: { userModules: Array<{ config: unknown }> };
  }): EmailSyncSchedule {
    const moduleConfig = source.user.userModules[0]?.config as
      { emailSync?: { schedule?: unknown } } | undefined;
    const configured = moduleConfig?.emailSync?.schedule;
    const schedule = parseEmailSyncSchedule(configured);
    if (schedule) {
      return schedule;
    }
    if (configured !== undefined) {
      this.logger.warn(
        `Invalid emailSync.schedule for source ${source.id}; using default`,
      );
    }
    return DEFAULT_EMAIL_SYNC_SCHEDULE;
  }
}
