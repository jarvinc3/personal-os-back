import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import { AnalyticsService } from '../application/analytics.service';
import { WeeklySummaryService } from '../application/weekly-summary.service';
import { SpendingOverTimeQueryDto } from './dto/spending-over-time-query.dto';
import {
  AnalyticsSummaryResponseDto,
  BudgetStatusResponseDto,
  SpendingByCategoryResponseDto,
  SpendingOverTimeResponseDto,
  WeeklySummaryResponseDto,
} from './dto/analytics-response.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance/analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly weeklySummary: WeeklySummaryService,
  ) {}

  @Get('weekly-summary')
  @ApiOkResponse({ type: WeeklySummaryResponseDto })
  weeklySummaryReport(
    @CurrentUser('sub') userId: string,
    @Query('weekStart') weekStart?: string,
  ) {
    return this.weeklySummary.build(userId, weekStart);
  }

  @Get('summary')
  @ApiOkResponse({ type: AnalyticsSummaryResponseDto })
  summary(
    @CurrentUser('sub') userId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.analytics.getAnalyticsSummary(userId, dateFrom, dateTo);
  }

  @Get('spending-by-category')
  @ApiOkResponse({ type: [SpendingByCategoryResponseDto] })
  spendingByCategory(
    @CurrentUser('sub') userId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.analytics.getSpendingByCategory(userId, dateFrom, dateTo);
  }

  @Get('budget-status')
  @ApiOkResponse({ type: [BudgetStatusResponseDto] })
  budgetStatus(@CurrentUser('sub') userId: string) {
    return this.analytics.getBudgetStatus(userId);
  }

  @Get('spending-over-time')
  @ApiOkResponse({ type: SpendingOverTimeResponseDto })
  spendingOverTime(
    @CurrentUser('sub') userId: string,
    @Query() query: SpendingOverTimeQueryDto,
  ) {
    return this.analytics.getSpendingOverTime({
      userId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      granularity: query.granularity,
    });
  }
}
