import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { DomainEventsModule } from '@personal-os/core';
import { FinanceFxModule } from '../fx/fx.module';
import { FinancePlanningThresholdModule } from '../planning/planning-threshold.module';
import { FinanceMerchantsModule } from '../merchants/merchants.module';
import { FinanceSubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { DeletionJournalModule } from '../shared/deletion-journal.module';
import {
  LEDGER_DELETION_REPOSITORY,
  LEDGER_IMPORT_REPOSITORY,
  LEDGER_REVERSAL_REPOSITORY,
  LEDGER_STATUS_REPOSITORY,
  LEDGER_QUERY_REPOSITORY,
  LEDGER_WRITE_REPOSITORY,
} from '../shared/application/tokens';
import { AdjustBalanceUseCase } from './application/adjust-balance.use-case';
import { ConfirmTransactionUseCase } from './application/confirm-transaction.use-case';
import { CreateTransactionUseCase } from './application/create-transaction.use-case';
import { CreateTransferUseCase } from './application/create-transfer.use-case';
import { ConfirmTransferUseCase } from './application/confirm-transfer.use-case';
import { CreateCardPaymentUseCase } from './application/create-card-payment.use-case';
import { ImportCardPaymentUseCase } from './application/import-card-payment.use-case';
import { UpdateCardPaymentUseCase } from './application/update-card-payment.use-case';
import { DeleteTransactionUseCase } from './application/delete-transaction.use-case';
import { MarkNotDuplicateUseCase } from './application/mark-not-duplicate.use-case';
import { MergeTransactionUseCase } from './application/merge-transaction.use-case';
import { ImportFinancialTransactionUseCase } from './application/import-financial-transaction.use-case';
import { LedgerQueryService } from './application/ledger-query.service';
import { PurgeInstrumentLedgerUseCase } from './application/purge-instrument-ledger.use-case';
import { RestoreInstrumentLedgerUseCase } from './application/restore-instrument-ledger.use-case';
import { RestoreTransactionUseCase } from './application/restore-transaction.use-case';
import { ReverseTransactionUseCase } from './application/reverse-transaction.use-case';
import { ReverseTransferUseCase } from './application/reverse-transfer.use-case';
import { UpdateTransactionUseCase } from './application/update-transaction.use-case';
import { UnconfirmTransactionUseCase } from './application/unconfirm-transaction.use-case';
import { UpdateTransferUseCase } from './application/update-transfer.use-case';
import { UnconfirmTransferUseCase } from './application/unconfirm-transfer.use-case';
import { PrismaLedgerDeletionRepository } from './infrastructure/prisma-ledger-deletion.repository';
import { PrismaLedgerImportRepository } from './infrastructure/prisma-ledger-import.repository';
import { PrismaLedgerWriteRepository } from './infrastructure/prisma-ledger-write.repository';
import { PrismaLedgerReadRepository } from './infrastructure/prisma-ledger-read.repository';
import { PrismaLedgerReversalRepository } from './infrastructure/prisma-ledger-reversal.repository';
import { PrismaLedgerStatusRepository } from './infrastructure/prisma-ledger-status.repository';
import { TransactionsController } from './presentation/transactions.controller';
import { TransfersController } from './presentation/transfers.controller';
import { CardPaymentsController } from './presentation/card-payments.controller';

@Module({
  imports: [
    FinanceFxModule,
    DomainEventsModule,
    FinancePlanningThresholdModule,
    FinanceMerchantsModule,
    FinanceSubscriptionsModule,
    FinanceOwnershipModule,
    LogosModule,
    DeletionJournalModule,
  ],
  controllers: [
    TransactionsController,
    TransfersController,
    CardPaymentsController,
  ],
  providers: [
    PrismaLedgerReadRepository,
    PrismaLedgerDeletionRepository,
    PrismaLedgerImportRepository,
    PrismaLedgerWriteRepository,
    PrismaLedgerStatusRepository,
    PrismaLedgerReversalRepository,
    {
      provide: LEDGER_QUERY_REPOSITORY,
      useExisting: PrismaLedgerReadRepository,
    },
    {
      provide: LEDGER_WRITE_REPOSITORY,
      useExisting: PrismaLedgerWriteRepository,
    },
    {
      provide: LEDGER_STATUS_REPOSITORY,
      useExisting: PrismaLedgerStatusRepository,
    },
    {
      provide: LEDGER_REVERSAL_REPOSITORY,
      useExisting: PrismaLedgerReversalRepository,
    },
    {
      provide: LEDGER_DELETION_REPOSITORY,
      useExisting: PrismaLedgerDeletionRepository,
    },
    {
      provide: LEDGER_IMPORT_REPOSITORY,
      useExisting: PrismaLedgerImportRepository,
    },
    LedgerQueryService,
    CreateTransactionUseCase,
    AdjustBalanceUseCase,
    UpdateTransactionUseCase,
    UnconfirmTransactionUseCase,
    ConfirmTransactionUseCase,
    DeleteTransactionUseCase,
    MergeTransactionUseCase,
    MarkNotDuplicateUseCase,
    PurgeInstrumentLedgerUseCase,
    RestoreInstrumentLedgerUseCase,
    RestoreTransactionUseCase,
    CreateTransferUseCase,
    UpdateTransferUseCase,
    UnconfirmTransferUseCase,
    ConfirmTransferUseCase,
    ReverseTransferUseCase,
    CreateCardPaymentUseCase,
    ImportCardPaymentUseCase,
    UpdateCardPaymentUseCase,
    ReverseTransactionUseCase,
    ImportFinancialTransactionUseCase,
  ],
  exports: [
    LEDGER_QUERY_REPOSITORY,
    LEDGER_WRITE_REPOSITORY,
    LEDGER_REVERSAL_REPOSITORY,
    LEDGER_STATUS_REPOSITORY,
    LEDGER_DELETION_REPOSITORY,
    LEDGER_IMPORT_REPOSITORY,
    LedgerQueryService,
    CreateTransactionUseCase,
    AdjustBalanceUseCase,
    UpdateTransactionUseCase,
    UnconfirmTransactionUseCase,
    ConfirmTransactionUseCase,
    DeleteTransactionUseCase,
    MergeTransactionUseCase,
    MarkNotDuplicateUseCase,
    PurgeInstrumentLedgerUseCase,
    RestoreInstrumentLedgerUseCase,
    RestoreTransactionUseCase,
    CreateTransferUseCase,
    UpdateTransferUseCase,
    UnconfirmTransferUseCase,
    ConfirmTransferUseCase,
    ReverseTransferUseCase,
    CreateCardPaymentUseCase,
    ImportCardPaymentUseCase,
    UpdateCardPaymentUseCase,
    ReverseTransactionUseCase,
    ImportFinancialTransactionUseCase,
  ],
})
export class FinanceLedgerModule {}
