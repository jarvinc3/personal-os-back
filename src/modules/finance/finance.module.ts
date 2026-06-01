import { Module } from '@nestjs/common';
import { EmailParserRegistry } from './email-parsers/email-parser.registry';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { FinanceService } from './finance.service';
import { GmailSyncProcessor } from './gmail-sync.processor';

@Module({
  controllers: [FinanceController],
  providers: [FinanceRepository, FinanceService, GmailSyncProcessor, EmailParserRegistry],
  exports: [FinanceService],
})
export class FinanceModule {}
