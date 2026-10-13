import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeletionJournalRepository } from './deletion-journal.repository';

/** Drops deletion journal entries past their 30-day retention window. */
@Injectable()
export class DeletionJournalRetentionScheduler {
  private readonly logger = new Logger(DeletionJournalRetentionScheduler.name);

  constructor(private readonly journal: DeletionJournalRepository) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpired(): Promise<void> {
    const { count } = await this.journal.purgeExpired(new Date());
    if (count > 0) {
      this.logger.log(`Purged ${count} expired deletion journal entries`);
    }
  }
}
