import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { isBullMqEnabledFromProcessEnv } from '../../../config';
import { QueueNames } from '../../../core/queues/queue.constants';
import { AiCoreModule } from '../../ai-agent';
import { FinanceEventsModule } from '../events/events.module';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { EMAIL_TRANSACTION_EXTRACTOR } from '../shared/application/tokens';
import { EnqueueDueGmailSyncsUseCase } from './application/enqueue-due-gmail-syncs.use-case';
import { IngestionService } from './application/ingestion.service';
import { ProcessGmailSyncUseCase } from './application/process-gmail-sync.use-case';
import { AiEmailTransactionExtractor } from './infrastructure/ai-email-transaction.extractor';
import { EmailSourceRepository } from './infrastructure/email-source.repository';
import { GmailAutoSyncScheduler } from './infrastructure/gmail-auto-sync.scheduler';
import { GmailSyncProcessor } from './infrastructure/gmail-sync.processor';
import { EmailSyncController } from './presentation/email-sync.controller';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();

@Module({
  imports: [
    FinanceEventsModule,
    FinanceLedgerModule,
    FinanceOwnershipModule,
    AiCoreModule,
    ...(bullMqEnabled
      ? [BullModule.registerQueue({ name: QueueNames.GMAIL_SYNC })]
      : []),
  ],
  controllers: [EmailSyncController],
  providers: [
    EmailSourceRepository,
    IngestionService,
    EnqueueDueGmailSyncsUseCase,
    GmailAutoSyncScheduler,
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
