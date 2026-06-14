import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { isBullMqEnabledFromProcessEnv } from '../../config';
import { QueueNames } from '../../core/queues/queue.constants';
import { EmailParserRegistry } from './email-parsers/email-parser.registry';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { FinanceService } from './finance.service';
import { GmailSyncProcessor } from './gmail-sync.processor';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();

@Module({
  imports: bullMqEnabled
    ? [BullModule.registerQueue({ name: QueueNames.GMAIL_SYNC })]
    : [],
  controllers: [FinanceController],
  providers: [FinanceRepository, FinanceService, GmailSyncProcessor, EmailParserRegistry],
  exports: [FinanceService],
})
export class FinanceModule {}
