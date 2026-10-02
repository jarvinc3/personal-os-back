import { Module } from '@nestjs/common';
import { FinanceBalanceSheetModule } from '../balance-sheet/balance-sheet.module';
import { AnalyticsService } from './application/analytics.service';
import { AnalyticsRepository } from './infrastructure/analytics.repository';
import { AnalyticsController } from './presentation/analytics.controller';

@Module({
  imports: [FinanceBalanceSheetModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsRepository, AnalyticsService],
  exports: [AnalyticsService],
})
export class FinanceAnalyticsModule {}
