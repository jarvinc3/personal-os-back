import { Module } from '@nestjs/common';
import { FinanceEventsModule } from '../events/events.module';
import { FinanceFxModule } from '../fx/fx.module';
import { FinanceMerchantsModule } from '../merchants/merchants.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { RecurringAlertsService } from './application/recurring-alerts.service';
import { RecurringService } from './application/recurring.service';
import { RecurringDetectionScheduler } from './infrastructure/recurring-detection.scheduler';
import { RecurringRepository } from './infrastructure/recurring.repository';
import { RecurringController } from './presentation/recurring.controller';

@Module({
  imports: [
    FinanceOwnershipModule,
    FinanceMerchantsModule,
    FinanceFxModule,
    FinanceEventsModule,
  ],
  controllers: [RecurringController],
  providers: [
    RecurringRepository,
    RecurringService,
    RecurringAlertsService,
    RecurringDetectionScheduler,
  ],
  exports: [RecurringService, RecurringRepository, RecurringAlertsService],
})
export class FinanceRecurringModule {}
