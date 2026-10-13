import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
const budgetRollovers = ['NONE', 'SURPLUS', 'SURPLUS_AND_DEFICIT'] as const;

export class CreateBudgetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  categoryIds!: string[];

  /** Legacy single-category field; kept so older clients keep working. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

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

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeChildren?: boolean;

  @ApiPropertyOptional({ enum: budgetRollovers, default: 'NONE' })
  @IsOptional()
  @IsEnum(budgetRollovers)
  rollover?: (typeof budgetRollovers)[number];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  recurring?: boolean;
}
