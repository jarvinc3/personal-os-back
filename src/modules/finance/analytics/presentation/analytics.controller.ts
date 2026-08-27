import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  RequiresEnabledModule,
} from '../../../../core/decorators';
import { AnalyticsService } from '../application/analytics.service';
import { SpendingOverTimeQueryDto } from './dto/spending-over-time-query.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  summary(
    @CurrentUser('sub') userId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.analytics.getAnalyticsSummary(userId, dateFrom, dateTo);
  }

  @Get('spending-by-category')
  spendingByCategory(
    @CurrentUser('sub') userId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.analytics.getSpendingByCategory(userId, dateFrom, dateTo);
  }

  @Get('budget-status')
  budgetStatus(@CurrentUser('sub') userId: string) {
    return this.analytics.getBudgetStatus(userId);
  }

  @Get('spending-over-time')
  spendingOverTime(
    @CurrentUser('sub') userId: string,
    @Query() query: SpendingOverTimeQueryDto,
  ) {
    return this.analytics.getSpendingOverTime(
      userId,
      query.dateFrom,
      query.dateTo,
      query.granularity ?? 'day',
    );
  }
}
