import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const budgetPeriods = ['MONTHLY', 'BIWEEKLY', 'CUSTOM'] as const;

export class CreateBudgetDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
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
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  alertThresholdPct?: number;
}
