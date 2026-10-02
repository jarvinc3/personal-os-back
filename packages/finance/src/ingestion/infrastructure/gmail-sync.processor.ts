import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { GmailSyncJob } from '@personal-os/core';
import { QueueNames } from '@personal-os/core';
import { ProcessGmailSyncUseCase } from '../application/process-gmail-sync.use-case';

@Injectable()
@Processor(QueueNames.GMAIL_SYNC)
export class GmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(GmailSyncProcessor.name);

  constructor(private readonly processSync: ProcessGmailSyncUseCase) {
    super();
  }

  async process(job: Job<GmailSyncJob>): Promise<void> {
    const { userId, sourceId, forceFullSync } = job.data;
    await this.processSync.execute({ userId, sourceId, forceFullSync });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GmailSyncJob>, error: Error) {
    this.logger.error(
      `Gmail sync job ${job.id ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
