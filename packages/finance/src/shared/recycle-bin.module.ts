import { Module } from '@nestjs/common';
import { RecycleBinService } from './application/recycle-bin.service';
import { DeletionJournalModule } from './deletion-journal.module';
import { RecycleBinRepository } from './infrastructure/recycle-bin.repository';
import { RecycleBinController } from './presentation/recycle-bin.controller';

@Module({
  imports: [DeletionJournalModule],
  controllers: [RecycleBinController],
  providers: [RecycleBinRepository, RecycleBinService],
})
export class FinanceRecycleBinModule {}
