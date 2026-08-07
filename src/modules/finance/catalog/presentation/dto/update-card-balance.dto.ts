import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional } from 'class-validator';
import { RequiredCurrencyField } from '../../../shared/presentation/validation.decorators';

export class UpdateCardBalanceDto {
  @ApiProperty({ description: 'ISO 4217 currency code', example: 'DOP' })
  @RequiredCurrencyField()
  currency!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  balance!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  creditLimit?: number;
}
