import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { FinanceService } from './finance.service';
import { GmailSyncProcessor } from './gmail-sync.processor';

@Module({
  controllers: [FinanceController],
  providers: [FinanceRepository, FinanceService, GmailSyncProcessor],
  exports: [FinanceService],
})
export class FinanceModule {}
