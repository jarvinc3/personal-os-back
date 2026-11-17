import { Module } from '@nestjs/common';
import { DomainEventsModule } from '@personal-os/core';
import { BUDGET_THRESHOLD_PORT } from '../shared/application/tokens';
import { BudgetThresholdService } from './application/budget-threshold.service';

/**
 * Thin module exporting only threshold processing so Ledger can import it
 * without depending on full PlanningModule (avoids circular deps).
 */
@Module({
  imports: [DomainEventsModule],
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
