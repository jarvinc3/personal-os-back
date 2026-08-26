import { Module } from '@nestjs/common';
import { FinanceFxModule } from '../fx/fx.module';
import { AnalyticsService } from './application/analytics.service';
import { AnalyticsRepository } from './infrastructure/analytics.repository';
import { AnalyticsController } from './presentation/analytics.controller';

@Module({
  imports: [FinanceFxModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsRepository, AnalyticsService],
  exports: [AnalyticsService],
})
export class FinanceAnalyticsModule {}
