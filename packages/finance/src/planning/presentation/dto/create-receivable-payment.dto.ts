import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReceivablePaymentDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ description: 'Account the money entered' })
  @IsUUID()
  accountId!: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;

  @ApiPropertyOptional({
    enum: ['EXTRA_INCOME', 'CREDIT_BALANCE', 'APPLY_TO_RECEIVABLE'],
  })
  @IsOptional()
  @IsEnum(['EXTRA_INCOME', 'CREDIT_BALANCE', 'APPLY_TO_RECEIVABLE'])
  excessHandling?: 'EXTRA_INCOME' | 'CREDIT_BALANCE' | 'APPLY_TO_RECEIVABLE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetReceivableId?: string;

  @ApiPropertyOptional({
    description:
      'Movimiento existente que ya representa el cobro; no crea otro.',
  })
  @IsOptional()
  @IsUUID()
  transactionId?: string;
}
