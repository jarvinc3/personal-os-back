import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsDateString,
    IsEnum,
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

export class CreateLoanDto {
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
  originalAmount!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  currentBalance!: number;

  @ApiPropertyOptional({ default: 'DOP', example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  installmentAmount!: number;

  @ApiProperty({ enum: installmentFreqs })
  @IsEnum(installmentFreqs)
  installmentFreq!: (typeof installmentFreqs)[number];

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  totalInstallments!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
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
}
