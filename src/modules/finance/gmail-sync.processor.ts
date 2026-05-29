import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueNames } from '../../core/queues/queue.constants';
import { GmailSyncJob } from '../../core/queues/queue-jobs';
import { FinanceRepository } from './finance.repository';

@Injectable()
@Processor(QueueNames.GMAIL_SYNC)
export class GmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(GmailSyncProcessor.name);

  constructor(private readonly financeRepo: FinanceRepository) {
    super();
  }

  async process(job: Job<GmailSyncJob>): Promise<void> {
    const { userId, sourceId } = job.data;
    const source = await this.financeRepo.findEmailSource(userId, sourceId);
    if (!source || !source.isActive) {
      this.logger.warn(`Gmail sync source not found or inactive: ${sourceId}`);
      return;
    }

    const syncLog = await this.financeRepo.createEmailSyncLog(sourceId);

    try {
      // Placeholder parser flow:
      // 1) call Gmail API with OAuth tokens from source
      // 2) parse emails by bankDomain (BHD / Popular / Qik)
      // 3) create transactions with source=EMAIL and status=PENDING
      // 4) update lastMessageId + lastSyncedAt
      await this.financeRepo.updateEmailSource(userId, sourceId, {
        lastSyncedAt: new Date(),
      });

      await this.financeRepo.completeEmailSyncLog(syncLog.id, {
        status: 'SUCCESS',
        emailsScanned: 0,
        transactionsNew: 0,
      });
    } catch (error) {
      await this.financeRepo.completeEmailSyncLog(syncLog.id, {
        status: 'FAILED',
        emailsScanned: 0,
        transactionsNew: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GmailSyncJob>, error: Error) {
    this.logger.error(`Gmail sync job ${job.id ?? 'unknown'} failed: ${error.message}`);
  }
}
