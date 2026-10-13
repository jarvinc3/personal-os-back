import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrencyField } from '../../../shared/presentation/validation.decorators';

const installmentFreqs = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

/** Fields shared by creating and editing a loan. */
export class LoanFieldsDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  lenderName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  institutionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  originalAmount!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  currentBalance!: number;

  @ApiPropertyOptional({ default: 'DOP', example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  installmentAmount!: number;

  @ApiProperty({ enum: installmentFreqs })
  @IsEnum(installmentFreqs)
  installmentFreq!: (typeof installmentFreqs)[number];

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalInstallments!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  paidInstallments?: number;

  @ApiProperty()
  @IsDateString()
  nextDueDate!: string;

  /** Annual rate as a fraction (0.1250 = 12.50%). Null means not provided. */
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 1,
    example: 0.12,
    description: 'Fraction 0–1 (e.g. 0.12 = 12%). Not a percent integer.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  interestRate?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional({ enum: ['FIXED', 'VARIABLE'], default: 'FIXED' })
  @IsOptional()
  @IsEnum(['FIXED', 'VARIABLE'] as const)
  rateType?: 'FIXED' | 'VARIABLE';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  insuranceAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  prepaymentPenaltyPct?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  disbursementDate?: string | null;
}
