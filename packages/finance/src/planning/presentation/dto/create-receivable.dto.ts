import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CurrencyField } from '../../../shared/presentation/validation.decorators';
import { RECEIVABLE_STATUSES } from '../../application/resolve-receivable-payment';

export class CreateReceivableDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  debtorName!: string;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  description!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  paidAmount?: number;

  @ApiPropertyOptional({ enum: RECEIVABLE_STATUSES, default: 'PENDING' })
  @IsOptional()
  @IsEnum(RECEIVABLE_STATUSES)
  status?: (typeof RECEIVABLE_STATUSES)[number];

  @ApiPropertyOptional({ default: 'DOP', example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
