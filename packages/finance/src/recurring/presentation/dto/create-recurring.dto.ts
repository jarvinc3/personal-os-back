import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { RECURRING_PERIODICITIES } from '../../domain/recurring-detection';

export const RECURRING_KINDS = [
  'SUBSCRIPTION',
  'BILL',
  'INCOME',
  'OTHER',
] as const;

export class CreateRecurringDto {
  @ApiPropertyOptional({ description: 'Raw merchant text' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  merchant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  avgAmount!: number;

  @ApiPropertyOptional({ default: 'DOP' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ enum: RECURRING_PERIODICITIES })
  @Type(() => Number)
  @IsIn(RECURRING_PERIODICITIES)
  frequency!: (typeof RECURRING_PERIODICITIES)[number];

  @ApiProperty({ description: 'Next expected charge (ISO date)' })
  @IsDateString()
  nextExpectedDate!: string;

  @ApiPropertyOptional({ enum: RECURRING_KINDS })
  @IsOptional()
  @IsIn(RECURRING_KINDS)
  kind?: (typeof RECURRING_KINDS)[number];
}
