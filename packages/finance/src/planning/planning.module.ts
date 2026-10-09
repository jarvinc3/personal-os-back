import { Module } from '@nestjs/common';
import { FinanceLedgerModule } from '../ledger/ledger.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { PayNextLoanInstallmentUseCase } from './application/pay-next-loan-installment.use-case';
import { PlanningService } from './application/planning.service';
import { SyncLoanInstallmentsUseCase } from './application/sync-loan-installments.use-case';
import { PlanningRepository } from './infrastructure/planning.repository';
import { LoanInstallmentsBackfill } from './infrastructure/loan-installments-backfill';
import { BudgetsController } from './presentation/budgets.controller';
import { LoansController } from './presentation/loans.controller';
import { ReceivablesController } from './presentation/receivables.controller';
import { SavingsGoalsController } from './presentation/savings-goals.controller';
import { FinancePlanningThresholdModule } from './planning-threshold.module';

@Module({
  imports: [
    FinancePlanningThresholdModule,
    FinanceOwnershipModule,
    FinanceLedgerModule,
  ],
  controllers: [
    BudgetsController,
    SavingsGoalsController,
    LoansController,
    ReceivablesController,
  ],
  providers: [
    PlanningRepository,
    PlanningService,
    SyncLoanInstallmentsUseCase,
    PayNextLoanInstallmentUseCase,
    LoanInstallmentsBackfill,
  ],
  exports: [
    PlanningService,
    PlanningRepository,
    FinancePlanningThresholdModule,
  ],
})
export class FinancePlanningModule {}
