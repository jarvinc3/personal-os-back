import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BUDGET_PERIOD_TYPE } from '../../../planning/domain/budget-period';

const BALANCE_STATUSES = ['COMPLETE', 'INCOMPLETE'] as const;
const BALANCE_ISSUE_CODES = ['MISSING_CREDIT_LIMIT', 'MISSING_RATE'] as const;

export class AnalyticsBalanceIssueResponseDto {
  @ApiProperty({ enum: BALANCE_ISSUE_CODES })
  code!: string;

  @ApiPropertyOptional({ type: String })
  cardId?: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;
}

export class AnalyticsSummaryTotalsResponseDto {
  @ApiProperty({ example: '1500.00' })
  accountBalance!: string;

  @ApiProperty({ nullable: true, type: String, example: '0.00' })
  cardDebt!: string | null;

  @ApiProperty({ example: '1500.00' })
  income!: string;

  @ApiProperty({ example: '1500.00' })
  expenses!: string;
}

export class AnalyticsSummaryResponseDto {
  @ApiProperty({ nullable: true, type: String, example: '1500.00' })
  netWorth!: string | null;

  @ApiProperty({ example: '1500.00' })
  cashFlow!: string;

  @ApiProperty({ example: 'DOP' })
  baseCurrency!: string;

  @ApiProperty({ enum: BALANCE_STATUSES })
  balanceStatus!: string;

  @ApiProperty({ type: () => [AnalyticsBalanceIssueResponseDto] })
  balanceIssues!: AnalyticsBalanceIssueResponseDto[];

  @ApiProperty({ type: () => AnalyticsSummaryTotalsResponseDto })
  totals!: AnalyticsSummaryTotalsResponseDto;
}

export class SpendingByCategoryResponseDto {
  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty({ nullable: true, type: String })
  icon!: string | null;

  @ApiProperty({ example: '1500.00' })
  total!: string;
}

export class BudgetStatusResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty()
  category!: string;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty({ nullable: true, type: String })
  icon!: string | null;

  @ApiProperty({ enum: Object.values(BUDGET_PERIOD_TYPE) })
  periodType!: string;

  @ApiProperty({ format: 'date' })
  periodStart!: string;

  @ApiProperty({ format: 'date' })
  periodEnd!: string;

  @ApiProperty({ example: '1500.00' })
  amountLimit!: string;

  @ApiProperty({ example: '1500.00' })
  amountSpent!: string;

  @ApiProperty()
  pctUsed!: number;

  @ApiProperty()
  threshold!: number;
}

export class SpendingOverTimePointResponseDto {
  @ApiProperty({ format: 'date' })
  date!: string;

  @ApiProperty({ example: '1500.00' })
  expenses!: string;

  @ApiProperty({ example: '1500.00' })
  income!: string;
}

export class SpendingOverTimeResponseDto {
  @ApiProperty({ type: () => [SpendingOverTimePointResponseDto] })
  points!: SpendingOverTimePointResponseDto[];
}

export class WeeklySummaryTopCategoryResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  icon!: string | null;

  @ApiProperty({ nullable: true, type: String })
  color!: string | null;

  @ApiProperty({ example: '1500.00' })
  total!: string;
}

export class WeeklySummaryBudgetRiskResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  pctUsed!: number;

  @ApiProperty({ example: '1500.00' })
  spent!: string;

  @ApiProperty({ example: '1500.00' })
  limit!: string;
}

export class WeeklySummaryInstallmentResponseDto {
  @ApiProperty()
  loanId!: string;

  @ApiProperty()
  lenderName!: string;

  @ApiProperty({ example: '1500.00' })
  amount!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ format: 'date' })
  dueDate!: string;
}

export class WeeklySummaryCardDueResponseDto {
  @ApiProperty()
  cardId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  lastFour!: string | null;

  @ApiProperty()
  dueDay!: number;
}

export class WeeklySummaryResponseDto {
  @ApiProperty({ format: 'date' })
  weekStart!: string;

  @ApiProperty({ format: 'date' })
  weekEnd!: string;

  @ApiProperty({ example: 'DOP' })
  currency!: string;

  @ApiProperty({ example: '1500.00' })
  expenses!: string;

  @ApiProperty({ example: '1500.00' })
  averageExpenses!: string;

  @ApiProperty({ type: () => [WeeklySummaryTopCategoryResponseDto] })
  topCategories!: WeeklySummaryTopCategoryResponseDto[];

  @ApiProperty({ type: () => [WeeklySummaryBudgetRiskResponseDto] })
  budgetsAtRisk!: WeeklySummaryBudgetRiskResponseDto[];

  @ApiProperty({ type: () => [WeeklySummaryInstallmentResponseDto] })
  upcomingInstallments!: WeeklySummaryInstallmentResponseDto[];

  @ApiProperty({ type: () => [WeeklySummaryCardDueResponseDto] })
  cardDueDates!: WeeklySummaryCardDueResponseDto[];

  @ApiProperty()
  pendingEmails!: number;
}
