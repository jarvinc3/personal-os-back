import { Module } from '@nestjs/common';
import { FinanceBalanceSheetModule } from '../balance-sheet/balance-sheet.module';
import { FinanceCatalogModule } from '../catalog/catalog.module';
import { DomainEventsModule } from '@personal-os/core';
import { FinanceFxModule } from '../fx/fx.module';
import { FinancePlanningModule } from '../planning/planning.module';
import { AnalyticsService } from './application/analytics.service';
import { WeeklySummaryService } from './application/weekly-summary.service';
import { AnalyticsRepository } from './infrastructure/analytics.repository';
import { WeeklySummaryScheduler } from './infrastructure/weekly-summary.scheduler';
import { AnalyticsController } from './presentation/analytics.controller';

@Module({
  imports: [
    FinanceBalanceSheetModule,
    FinanceCatalogModule,
    DomainEventsModule,
    FinanceFxModule,

    FinancePlanningModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsRepository,
    AnalyticsService,
    WeeklySummaryService,
    WeeklySummaryScheduler,
  ],
  exports: [AnalyticsService, WeeklySummaryService],
})
export class FinanceAnalyticsModule {}
