import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { isBullMqEnabledFromProcessEnv } from '@personal-os/config';
import { QueueNames } from '@personal-os/core';
import { FinanceEventsModule } from '../events/events.module';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { EMAIL_TRANSACTION_EXTRACTOR } from '../shared/application/tokens';
import { EnqueueDueGmailSyncsUseCase } from './application/enqueue-due-gmail-syncs.use-case';
import { EmailSourceService } from './application/email-source.service';
import { GmailSyncQueueService } from './application/gmail-sync-queue.service';
import { IngestionService } from './application/ingestion.service';
import { ProcessGmailSyncUseCase } from './application/process-gmail-sync.use-case';
import {
  BackfillPendingEmailUseCase,
  MatchEmailTransfersUseCase,
} from './application/backfill-pending-email.use-case';
import { RouteExtractedEmailUseCase } from './application/route-extracted-email.use-case';
import { RetryPendingReversesUseCase } from './application/retry-pending-reverses.use-case';
import { AiEmailTransactionExtractor } from './infrastructure/ai-email-transaction.extractor';
import { EmailSourceRepository } from './infrastructure/email-source.repository';
import { EmailMessageRetentionScheduler } from './infrastructure/email-message-retention.scheduler';
import { GmailAutoSyncScheduler } from './infrastructure/gmail-auto-sync.scheduler';
import { GmailSyncProcessor } from './infrastructure/gmail-sync.processor';
import { EmailSyncController } from './presentation/email-sync.controller';

const bullMqEnabled = isBullMqEnabledFromProcessEnv();

@Module({
  imports: [
    FinanceEventsModule,
    FinanceLedgerModule,
    FinanceOwnershipModule,
    ...(bullMqEnabled
      ? [BullModule.registerQueue({ name: QueueNames.GMAIL_SYNC })]
      : []),
  ],
  controllers: [EmailSyncController],
  providers: [
    EmailSourceRepository,
    IngestionService,
    EmailSourceService,
    GmailSyncQueueService,
    EnqueueDueGmailSyncsUseCase,
    GmailAutoSyncScheduler,
    EmailMessageRetentionScheduler,
    ProcessGmailSyncUseCase,
    RouteExtractedEmailUseCase,
    RetryPendingReversesUseCase,
    BackfillPendingEmailUseCase,
    MatchEmailTransfersUseCase,
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
