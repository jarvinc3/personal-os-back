import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  CurrencyField,
  InstantDateField,
} from '../../../shared/presentation/validation.decorators';

const transactionStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;

export class CreateCardPaymentDto {
  @ApiProperty()
  @IsUUID()
  fromAccountId!: string;

  @ApiProperty()
  @IsUUID()
  cardId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @ApiPropertyOptional({ default: 'DOP', example: 'DOP' })
  @CurrencyField()
  currency?: string;

  @ApiProperty()
  @InstantDateField()
  transactionDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: transactionStatuses, default: 'CONFIRMED' })
  @IsOptional()
  @IsEnum(transactionStatuses)
  status?: (typeof transactionStatuses)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statementId?: string;
}

export class UpdateCardPaymentDto extends PartialType(CreateCardPaymentDto) {}
