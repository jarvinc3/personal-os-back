import { Module } from '@nestjs/common';
import { FinanceEventsModule } from '../events/events.module';
import { BUDGET_THRESHOLD_PORT } from '../shared/application/tokens';
import { BudgetThresholdService } from './application/budget-threshold.service';

/**
 * Thin module exporting only threshold processing so Ledger can import it
 * without depending on full PlanningModule (avoids circular deps).
 */
@Module({
  imports: [FinanceEventsModule],
  providers: [
    BudgetThresholdService,
    {
      provide: BUDGET_THRESHOLD_PORT,
      useExisting: BudgetThresholdService,
    },
  ],
  exports: [BUDGET_THRESHOLD_PORT, BudgetThresholdService],
})
export class FinancePlanningThresholdModule {}
