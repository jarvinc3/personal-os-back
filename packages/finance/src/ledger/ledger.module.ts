import { Module } from '@nestjs/common';
import { LogosModule } from '@personal-os/logos';
import { FinanceEventsModule } from '../events/events.module';
import { FinanceFxModule } from '../fx/fx.module';
import { FinancePlanningThresholdModule } from '../planning/planning-threshold.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { LEDGER_REPOSITORY } from '../shared/application/tokens';
import { ConfirmTransactionUseCase } from './application/confirm-transaction.use-case';
import { CreateTransactionUseCase } from './application/create-transaction.use-case';
import { CreateTransferUseCase } from './application/create-transfer.use-case';
import { DeleteTransactionUseCase } from './application/delete-transaction.use-case';
import { ImportEmailTransactionUseCase } from './application/import-email-transaction.use-case';
import { LedgerQueryService } from './application/ledger-query.service';
import { PurgeInstrumentLedgerUseCase } from './application/purge-instrument-ledger.use-case';
import { ReverseTransactionUseCase } from './application/reverse-transaction.use-case';
import { UpdateTransactionUseCase } from './application/update-transaction.use-case';
import { PrismaLedgerRepository } from './infrastructure/prisma-ledger.repository';
import { TransactionsController } from './presentation/transactions.controller';
import { TransfersController } from './presentation/transfers.controller';

@Module({
  imports: [
    FinanceFxModule,
    FinanceEventsModule,
    FinancePlanningThresholdModule,
    FinanceOwnershipModule,
    LogosModule,
  ],
  controllers: [TransactionsController, TransfersController],
  providers: [
    PrismaLedgerRepository,
    { provide: LEDGER_REPOSITORY, useExisting: PrismaLedgerRepository },
    LedgerQueryService,
    CreateTransactionUseCase,
    UpdateTransactionUseCase,
    ConfirmTransactionUseCase,
    DeleteTransactionUseCase,
    PurgeInstrumentLedgerUseCase,
    CreateTransferUseCase,
    ReverseTransactionUseCase,
    ImportEmailTransactionUseCase,
  ],
  exports: [
    LedgerQueryService,
    CreateTransactionUseCase,
    UpdateTransactionUseCase,
    ConfirmTransactionUseCase,
    DeleteTransactionUseCase,
    PurgeInstrumentLedgerUseCase,
    CreateTransferUseCase,
    ReverseTransactionUseCase,
    ImportEmailTransactionUseCase,
  ],
})
export class FinanceLedgerModule {}
