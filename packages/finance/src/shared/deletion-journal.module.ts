import { Module } from '@nestjs/common';
import { DeletionJournalRepository } from './infrastructure/deletion-journal.repository';

@Module({
  providers: [DeletionJournalRepository],
  exports: [DeletionJournalRepository],
})
export class DeletionJournalModule {}
