import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RECURRING_PERIODICITIES } from '../../domain/recurring-detection';
import { RECURRING_KINDS } from './create-recurring.dto';

export const RECURRING_STATUSES = [
  'SUGGESTED',
  'CONFIRMED',
  'DISMISSED',
] as const;

export class UpdateRecurringDto {
  @ApiPropertyOptional({ enum: RECURRING_STATUSES })
  @IsOptional()
  @IsIn(RECURRING_STATUSES)
  status?: (typeof RECURRING_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  merchant?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  avgAmount?: number;

  @ApiPropertyOptional({ default: 'DOP' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ enum: RECURRING_PERIODICITIES })
  @IsOptional()
  @Type(() => Number)
  @IsIn(RECURRING_PERIODICITIES)
  frequency?: (typeof RECURRING_PERIODICITIES)[number];

  @ApiPropertyOptional({ description: 'Next expected charge (ISO date)' })
  @IsOptional()
  @IsDateString()
  nextExpectedDate?: string;

  @ApiPropertyOptional({ enum: RECURRING_KINDS })
  @IsOptional()
  @IsIn(RECURRING_KINDS)
  kind?: (typeof RECURRING_KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  amountTolerancePct?: number;
}
