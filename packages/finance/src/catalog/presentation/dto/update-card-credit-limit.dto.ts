import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
import { RequiredCurrencyField } from '../../../shared/presentation/validation.decorators';

export class UpdateCardCreditLimitDto {
  @ApiProperty({ description: 'ISO 4217 currency code', example: 'DOP' })
  @RequiredCurrencyField()
  currency!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  creditLimit!: number;
}
