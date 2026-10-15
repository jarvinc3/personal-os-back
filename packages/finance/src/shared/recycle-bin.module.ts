import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { RecycleBinService } from './application/recycle-bin.service';
import { DeletionJournalModule } from './deletion-journal.module';
import { RecycleBinRepository } from './infrastructure/recycle-bin.repository';
import { RecycleBinController } from './presentation/recycle-bin.controller';

@Module({
  imports: [DeletionJournalModule, LogosModule],
  controllers: [RecycleBinController],
  providers: [RecycleBinRepository, RecycleBinService],
})
export class FinanceRecycleBinModule {}
