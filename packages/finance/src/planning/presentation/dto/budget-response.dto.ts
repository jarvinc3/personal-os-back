import { ApiProperty } from '@nestjs/swagger';
import { BUDGET_PERIOD_TYPE } from '../../domain/budget-period';
import { BUDGET_ROLLOVER } from '../../domain/budget-rollover';
import {
  CategoryResponseDto,
  CategorySummaryResponseDto,
} from '../../../shared/presentation/dto/category-response.dto';

const AI_SUGGESTION_STATUSES = [
  'NONE',
  'PENDING',
  'ACCEPTED',
  'REJECTED',
] as const;

export class BudgetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ nullable: true, type: String })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty()
  includeChildren!: boolean;

  @ApiProperty({ enum: Object.values(BUDGET_ROLLOVER) })
  rollover!: string;

  @ApiProperty({ example: '0.00' })
  carriedOver!: string;

  @ApiProperty()
  recurring!: boolean;

  @ApiProperty({ enum: Object.values(BUDGET_PERIOD_TYPE) })
  periodType!: string;

  @ApiProperty({ format: 'date-time' })
  periodStart!: string;

  @ApiProperty({ format: 'date-time' })
  periodEnd!: string;

  @ApiProperty({ example: '1500.00' })
  amountLimit!: string;

  @ApiProperty({ example: '1500.00' })
  amountSpent!: string;

  @ApiProperty({ example: 80 })
  alertThresholdPct!: number;

  @ApiProperty({ enum: AI_SUGGESTION_STATUSES })
  aiSuggestionStatus!: string;

  @ApiProperty({ type: Object, nullable: true })
  aiSuggestionPayload!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: () => CategoryResponseDto, nullable: true })
  category!: CategoryResponseDto | null;

  @ApiProperty({ type: () => [CategorySummaryResponseDto] })
  categories!: CategorySummaryResponseDto[];

  @ApiProperty({ example: '1500.00' })
  effectiveLimit!: string;
}

export class BudgetPageResponseDto {
  @ApiProperty({ type: () => [BudgetResponseDto] })
  items!: BudgetResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
