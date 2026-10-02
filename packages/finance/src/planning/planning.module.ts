import { Module } from '@nestjs/common';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { PlanningService } from './application/planning.service';
import { PlanningRepository } from './infrastructure/planning.repository';
import { BudgetsController } from './presentation/budgets.controller';
import { LoansController } from './presentation/loans.controller';
import { ReceivablesController } from './presentation/receivables.controller';
import { SavingsGoalsController } from './presentation/savings-goals.controller';
import { FinancePlanningThresholdModule } from './planning-threshold.module';

@Module({
  imports: [FinancePlanningThresholdModule, FinanceOwnershipModule],
  controllers: [
    BudgetsController,
    SavingsGoalsController,
    LoansController,
    ReceivablesController,
  ],
  providers: [PlanningRepository, PlanningService],
  exports: [
    PlanningService,
    PlanningRepository,
    FinancePlanningThresholdModule,
  ],
})
export class FinancePlanningModule {}
