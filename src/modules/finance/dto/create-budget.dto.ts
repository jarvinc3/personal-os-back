import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsUUID } from 'class-validator';

const budgetPeriods = ['MONTHLY', 'BIWEEKLY', 'CUSTOM'] as const;

export class CreateBudgetDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ enum: budgetPeriods })
  @IsEnum(budgetPeriods)
  periodType!: (typeof budgetPeriods)[number];

  @ApiProperty()
  @IsDateString()
  periodStart!: string;

  @ApiProperty()
  @IsDateString()
  periodEnd!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  amountLimit!: number;

  @ApiPropertyOptional({ default: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  alertThresholdPct?: number;
}
