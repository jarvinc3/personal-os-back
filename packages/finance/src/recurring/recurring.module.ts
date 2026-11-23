import { Module } from '@nestjs/common';
import { DomainEventsModule } from '@personal-os/core';
import { FinanceFxModule } from '../fx/fx.module';
import { FinanceMerchantsModule } from '../merchants/merchants.module';
import { FinanceOwnershipModule } from '../shared/finance-ownership.module';
import { RecurringAlertsService } from './application/recurring-alerts.service';
import { RecurringDetectionService } from './application/recurring-detection.service';
import { RecurringQueryService } from './application/recurring-query.service';
import { RecurringService } from './application/recurring.service';
import { RecurringWriteService } from './application/recurring-write.service';
import { RecurringDetectionScheduler } from './infrastructure/recurring-detection.scheduler';
import { RecurringRepository } from './infrastructure/recurring.repository';
import { RecurringController } from './presentation/recurring.controller';

@Module({
  imports: [
    FinanceOwnershipModule,
    FinanceMerchantsModule,
    FinanceFxModule,
    DomainEventsModule,
  ],
  controllers: [RecurringController],
  providers: [
    RecurringRepository,
    RecurringQueryService,
    RecurringWriteService,
    RecurringDetectionService,
    RecurringService,
    RecurringAlertsService,
    RecurringDetectionScheduler,
  ],
  exports: [RecurringService, RecurringRepository, RecurringAlertsService],
})
export class FinanceRecurringModule {}
