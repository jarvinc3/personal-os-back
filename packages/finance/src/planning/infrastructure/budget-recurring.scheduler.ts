import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PlanningService } from '../application/planning.service';

/** Creates the next period of every recurring budget once it starts. */
@Injectable()
export class BudgetRecurringScheduler {
  constructor(private readonly planning: PlanningService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  handleCron() {
    return this.planning.createRecurringBudgets(new Date());
  }
}
