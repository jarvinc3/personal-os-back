import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { FinanceEventsModule } from '../events/events.module';
import { FinanceFxModule } from '../fx/fx.module';
import { FinancePlanningThresholdModule } from '../planning/planning-threshold.module';
import { FinanceMerchantsModule } from '../merchants/merchants.module';
import { FinanceSubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { DeletionJournalModule } from '../shared/deletion-journal.module';
import { LEDGER_REPOSITORY } from '../shared/application/tokens';
import { AdjustBalanceUseCase } from './application/adjust-balance.use-case';
import { ConfirmTransactionUseCase } from './application/confirm-transaction.use-case';
import { CreateTransactionUseCase } from './application/create-transaction.use-case';
import { CreateTransferUseCase } from './application/create-transfer.use-case';
import { ConfirmTransferUseCase } from './application/confirm-transfer.use-case';
import { CreateCardPaymentUseCase } from './application/create-card-payment.use-case';
import { UpdateCardPaymentUseCase } from './application/update-card-payment.use-case';
import { DeleteTransactionUseCase } from './application/delete-transaction.use-case';
import { MarkNotDuplicateUseCase } from './application/mark-not-duplicate.use-case';
import { MergeTransactionUseCase } from './application/merge-transaction.use-case';
import { ImportEmailTransactionUseCase } from './application/import-email-transaction.use-case';
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
import { PrismaLedgerReadRepository } from './infrastructure/prisma-ledger-read.repository';
import { PrismaLedgerRepository } from './infrastructure/prisma-ledger.repository';
import { TransactionsController } from './presentation/transactions.controller';
import { TransfersController } from './presentation/transfers.controller';
import { CardPaymentsController } from './presentation/card-payments.controller';

@Module({
  imports: [
    FinanceFxModule,
    FinanceEventsModule,
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
    PrismaLedgerRepository,
    PrismaLedgerReadRepository,
    PrismaLedgerDeletionRepository,
    { provide: LEDGER_REPOSITORY, useExisting: PrismaLedgerRepository },
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
    UpdateCardPaymentUseCase,
    ReverseTransactionUseCase,
    ImportEmailTransactionUseCase,
  ],
  exports: [
    LEDGER_REPOSITORY,
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
    UpdateCardPaymentUseCase,
    ReverseTransactionUseCase,
    ImportEmailTransactionUseCase,
  ],
})
export class FinanceLedgerModule {}
