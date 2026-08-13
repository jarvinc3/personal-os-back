import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { isBullMqEnabledFromProcessEnv } from '../../../config';
import { QueueNames } from '../../../core/queues/queue.constants';
import { AiModule } from '../../ai-agent';
import { FinanceEventsModule } from '../events/events.module';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { EMAIL_TRANSACTION_EXTRACTOR } from '../shared/application/tokens';
import { IngestionService } from './application/ingestion.service';
import { ProcessGmailSyncUseCase } from './application/process-gmail-sync.use-case';
import { AiEmailTransactionExtractor } from './infrastructure/ai-email-transaction.extractor';
import { EmailSourceRepository } from './infrastructure/email-source.repository';
import { GmailSyncProcessor } from './infrastructure/gmail-sync.processor';
import { EmailSyncController } from './presentation/email-sync.controller';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();

@Module({
  imports: [
    FinanceEventsModule,
    FinanceLedgerModule,
    forwardRef(() => AiModule),
    ...(bullMqEnabled
      ? [BullModule.registerQueue({ name: QueueNames.GMAIL_SYNC })]
      : []),
  ],
  controllers: [EmailSyncController],
  providers: [
    EmailSourceRepository,
    IngestionService,
    ProcessGmailSyncUseCase,
    AiEmailTransactionExtractor,
    {
      provide: EMAIL_TRANSACTION_EXTRACTOR,
      useExisting: AiEmailTransactionExtractor,
    },
    GmailSyncProcessor,
  ],
  exports: [IngestionService, EMAIL_TRANSACTION_EXTRACTOR],
})
export class FinanceIngestionModule {}
