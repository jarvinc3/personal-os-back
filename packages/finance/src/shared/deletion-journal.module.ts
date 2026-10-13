import { Module } from '@nestjs/common';
import { DeletionJournalRepository } from './infrastructure/deletion-journal.repository';
import { DeletionJournalRetentionScheduler } from './infrastructure/deletion-journal-retention.scheduler';

@Module({
  providers: [DeletionJournalRepository, DeletionJournalRetentionScheduler],
  exports: [DeletionJournalRepository],
})
export class DeletionJournalModule {}
