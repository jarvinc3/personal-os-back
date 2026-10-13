import { Module } from '@nestjs/common';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { DeletionJournalModule } from '../shared/deletion-journal.module';
import { PayNextLoanInstallmentUseCase } from './application/pay-next-loan-installment.use-case';
import { ApplyLoanPrepaymentUseCase } from './application/apply-loan-prepayment.use-case';
import { WriteOffReceivableUseCase } from './application/write-off-receivable.use-case';
import { PlanningService } from './application/planning.service';
import { RecordReceivablePaymentUseCase } from './application/record-receivable-payment.use-case';
import { ApplyReceivableCreditUseCase } from './application/apply-receivable-credit.use-case';
import { AllocateToGoalUseCase } from './application/allocate-to-goal.use-case';
import { LinkTransactionUseCase } from './application/link-transaction.use-case';
import { UnlinkTransactionUseCase } from './application/unlink-transaction.use-case';
import { RemoveSavingsGoalContributionUseCase } from './application/remove-savings-goal-contribution.use-case';
import { SyncLoanInstallmentsUseCase } from './application/sync-loan-installments.use-case';
import { PlanningRepository } from './infrastructure/planning.repository';
import { BudgetRecurringScheduler } from './infrastructure/budget-recurring.scheduler';
import { LoanInstallmentsBackfill } from './infrastructure/loan-installments-backfill';
import { BudgetsController } from './presentation/budgets.controller';
import { LoansController } from './presentation/loans.controller';
import { ReceivablesController } from './presentation/receivables.controller';
import { SavingsGoalsController } from './presentation/savings-goals.controller';
import { TransactionLinksController } from './presentation/transaction-links.controller';
import { FinancePlanningThresholdModule } from './planning-threshold.module';

@Module({
  imports: [
    FinancePlanningThresholdModule,
    FinanceOwnershipModule,
    FinanceLedgerModule,
    DeletionJournalModule,
  ],
  controllers: [
    BudgetsController,
    SavingsGoalsController,
    LoansController,
    ReceivablesController,
    TransactionLinksController,
  ],
  providers: [
    PlanningRepository,
    PlanningService,
    SyncLoanInstallmentsUseCase,
    PayNextLoanInstallmentUseCase,
    ApplyLoanPrepaymentUseCase,
    RecordReceivablePaymentUseCase,
    ApplyReceivableCreditUseCase,
    WriteOffReceivableUseCase,
    AllocateToGoalUseCase,
    LinkTransactionUseCase,
    UnlinkTransactionUseCase,
    RemoveSavingsGoalContributionUseCase,
    LoanInstallmentsBackfill,
    BudgetRecurringScheduler,
  ],
  exports: [
    PlanningService,
    PlanningRepository,
    PayNextLoanInstallmentUseCase,
    ApplyLoanPrepaymentUseCase,
    AllocateToGoalUseCase,
    LinkTransactionUseCase,
    UnlinkTransactionUseCase,
    RecordReceivablePaymentUseCase,
    FinancePlanningThresholdModule,
  ],
})
export class FinancePlanningModule {}
